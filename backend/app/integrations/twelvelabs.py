import mimetypes
import os
import time
import uuid
from pathlib import Path

import requests

from app.core.config import REQUEST_TIMEOUT_SECONDS, TWELVELABS_BASE_URL, UPLOAD_TIMEOUT_SECONDS, twelvelabs_api_key
from app.core.errors import ApiError


UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024
DIRECT_UPLOAD_LIMIT_BYTES = int(os.environ.get("TWELVELABS_DIRECT_UPLOAD_LIMIT_BYTES", str(200 * 1024 * 1024)))
CHUNK_UPLOAD_TIMEOUT_SECONDS = int(os.environ.get("TWELVELABS_CHUNK_UPLOAD_TIMEOUT_SECONDS", "180"))
MULTIPART_STATUS_ATTEMPTS = int(os.environ.get("TWELVELABS_MULTIPART_STATUS_ATTEMPTS", "60"))
MULTIPART_STATUS_INTERVAL_SECONDS = int(os.environ.get("TWELVELABS_MULTIPART_STATUS_INTERVAL_SECONDS", "10"))
PRESIGNED_URL_BATCH_SIZE = int(os.environ.get("TWELVELABS_PRESIGNED_URL_BATCH_SIZE", "50"))


def json_headers():
    api_key = twelvelabs_api_key()
    if not api_key:
        raise ApiError("TWELVELABS_API_KEY is required", 500)
    return {"x-api-key": api_key, "Content-Type": "application/json"}


def file_headers():
    api_key = twelvelabs_api_key()
    if not api_key:
        raise ApiError("TWELVELABS_API_KEY is required", 500)
    return {"x-api-key": api_key}


def request_json(method, path, payload=None):
    try:
        response = requests.request(
            method,
            f"{TWELVELABS_BASE_URL}{path}",
            headers=json_headers(),
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise ApiError(str(exc), 502) from exc

    return parse_response(response)


def upload_asset(file):
    size = stream_size(file.stream)
    if size <= 0:
        raise ApiError("file is empty", 400)

    return upload_asset_stream(
        stream=file.stream,
        filename=file.filename,
        content_type=file.mimetype or "application/octet-stream",
        size=size,
    )


def upload_asset_path(path, multipart_state=None, on_state_change=None, progress=None):
    path = Path(path)
    if not path.exists() or not path.is_file():
        raise ApiError(f"asset file not found: {path}", 400)
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    with path.open("rb") as handle:
        return upload_asset_stream(
            stream=handle,
            filename=path.name,
            content_type=content_type,
            size=path.stat().st_size,
            multipart_state=multipart_state,
            on_state_change=on_state_change,
            progress=progress,
        )


def upload_asset_stream(
    stream,
    filename,
    content_type,
    size,
    multipart_state=None,
    on_state_change=None,
    progress=None,
):
    if size <= 0:
        raise ApiError("file is empty", 400)
    if size > DIRECT_UPLOAD_LIMIT_BYTES:
        return upload_asset_multipart(
            stream=stream,
            filename=filename,
            content_type=content_type,
            size=size,
            multipart_state=multipart_state,
            on_state_change=on_state_change,
            progress=progress,
        )
    return upload_asset_direct(stream, filename, content_type, size, progress=progress)


def upload_asset_direct(stream, filename, content_type, size, progress=None):
    boundary = f"sportsjockey-{uuid.uuid4().hex}"
    preamble = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="method"\r\n\r\n'
        "direct\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="enable_hls"\r\n\r\n'
        "true\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="enable_thumbnail"\r\n\r\n'
        "true\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode()
    ending = f"\r\n--{boundary}--\r\n".encode()
    content_length = len(preamble) + size + len(ending)

    def body():
        uploaded = 0
        next_report = 512 * 1024 * 1024
        stream.seek(0)
        yield preamble
        while True:
            chunk = stream.read(UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            uploaded += len(chunk)
            if progress and uploaded >= next_report:
                progress(f"uploaded {uploaded / (1024 ** 3):.1f} GB of {filename}")
                next_report += 512 * 1024 * 1024
            yield chunk
        yield ending

    try:
        response = requests.post(
            f"{TWELVELABS_BASE_URL}/assets",
            headers={
                **file_headers(),
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(content_length),
            },
            data=body(),
            timeout=(30, UPLOAD_TIMEOUT_SECONDS),
        )
    except requests.RequestException as exc:
        raise ApiError(str(exc), 502) from exc

    return parse_response(response)


def upload_asset_multipart(
    stream,
    filename,
    content_type,
    size,
    multipart_state=None,
    on_state_change=None,
    progress=None,
):
    multipart_state = multipart_state if isinstance(multipart_state, dict) else {}
    session = multipart_state.get("session")
    if not session:
        session = request_json(
            "post",
            "/assets/multipart-uploads",
            {
                "filename": filename,
                "type": "video" if content_type.startswith("video/") else "file",
                "total_size": size,
                "enable_hls": True,
                "enable_thumbnail": True,
            },
        )
        multipart_state["session"] = session
        multipart_state["completed_chunks"] = {}
        persist_state(on_state_change)
        if progress:
            progress(f"created multipart upload session {session['upload_id']} for {filename}")
    elif progress:
        progress(f"resuming multipart upload session {session['upload_id']} for {filename}")

    upload_id = session["upload_id"]
    asset_id = session["asset_id"]
    chunk_size = session["chunk_size"]
    total_chunks = session["total_chunks"]
    upload_headers = session.get("upload_headers") or {}
    completed_chunks = multipart_state.setdefault("completed_chunks", {})

    while len(completed_chunks) < total_chunks:
        pending_chunks = [chunk for chunk in range(1, total_chunks + 1) if str(chunk) not in completed_chunks]
        batch_start = pending_chunks[0]
        batch_stop = min(total_chunks, batch_start + PRESIGNED_URL_BATCH_SIZE - 1)
        batch_chunks = [chunk for chunk in pending_chunks if batch_start <= chunk <= batch_stop]
        upload_urls = request_presigned_urls(upload_id, batch_start, len(batch_chunks))

        missing_urls = [chunk for chunk in batch_chunks if chunk not in upload_urls]
        for chunk in missing_urls:
            upload_urls.update(request_presigned_urls(upload_id, chunk, 1))
        missing_urls = [chunk for chunk in batch_chunks if chunk not in upload_urls]
        if missing_urls:
            raise ApiError(f"missing presigned URLs for chunks: {missing_urls[:10]}", 502)

        if progress:
            progress(f"uploading chunks {batch_chunks[0]}-{batch_chunks[-1]} for {filename}")
        for chunk_index in batch_chunks:
            chunk_length = chunk_length_for(size, chunk_size, chunk_index)
            proof = upload_chunk(stream, chunk_size, chunk_index, chunk_length, upload_urls[chunk_index], upload_headers)
            completed_chunk = {
                "chunk_index": chunk_index,
                "proof": proof,
                "proof_type": "etag",
                "chunk_size": chunk_length,
            }
            report_uploaded_chunks(upload_id, [completed_chunk])
            completed_chunks[str(chunk_index)] = completed_chunk
            persist_state(on_state_change)
            uploaded_count = len(completed_chunks)
            if progress and (uploaded_count == 1 or uploaded_count == total_chunks or uploaded_count % 25 == 0):
                progress(f"uploaded {uploaded_count}/{total_chunks} chunks for {filename}")

    status = wait_for_multipart_completion(upload_id, progress=progress)
    multipart_state["status"] = status
    persist_state(on_state_change)
    if status.get("status") != "completed":
        raise ApiError({"message": "multipart upload did not complete", "status": status}, 502)

    return {"_id": asset_id, "method": "multipart", "status": "ready", "filename": filename}


def request_presigned_urls(upload_id, start, count):
    response = request_json(
        "post",
        f"/assets/multipart-uploads/{upload_id}/presigned-urls",
        {"start": start, "count": count},
    )
    return {int(entry["chunk_index"]): entry["url"] for entry in response.get("upload_urls", [])}


def upload_chunk(stream, chunk_size, chunk_index, chunk_length, url, upload_headers):
    stream.seek((chunk_index - 1) * chunk_size)
    chunk = stream.read(chunk_length)
    try:
        response = requests.put(
            url,
            data=chunk,
            headers=upload_headers,
            timeout=(30, CHUNK_UPLOAD_TIMEOUT_SECONDS),
        )
    except requests.RequestException as exc:
        raise ApiError(str(exc), 502) from exc
    if response.status_code >= 400:
        raise ApiError(response.text, response.status_code)
    etag = response.headers.get("ETag") or response.headers.get("etag")
    if not etag:
        raise ApiError("chunk upload response missing ETag", 502)
    return etag.strip('"')


def report_uploaded_chunks(upload_id, chunks):
    return request_json("post", f"/assets/multipart-uploads/{upload_id}", {"completed_chunks": chunks})


def wait_for_multipart_completion(upload_id, progress=None):
    status = {}
    for attempt in range(1, MULTIPART_STATUS_ATTEMPTS + 1):
        status = request_json("get", f"/assets/multipart-uploads/{upload_id}")
        if status.get("status") == "completed":
            return status
        if status.get("chunks_failed"):
            raise ApiError({"message": "multipart upload has failed chunks", "status": status}, 502)
        if progress:
            progress(
                f"multipart upload {upload_id}: {status.get('status', 'unknown')} "
                f"({status.get('chunks_completed', 0)} chunks completed), "
                f"attempt {attempt}/{MULTIPART_STATUS_ATTEMPTS}"
            )
        time.sleep(MULTIPART_STATUS_INTERVAL_SECONDS)
    return status


def chunk_length_for(size, chunk_size, chunk_index):
    offset = (chunk_index - 1) * chunk_size
    return min(chunk_size, size - offset)


def stream_size(stream):
    position = stream.tell()
    stream.seek(0, os.SEEK_END)
    size = stream.tell()
    stream.seek(position)
    return size


def persist_state(on_state_change):
    if on_state_change:
        on_state_change()


def parse_response(response):
    if response.status_code == 204 or not response.content:
        if response.status_code >= 400:
            raise ApiError(response.text, response.status_code)
        return {}

    try:
        data = response.json()
    except ValueError as exc:
        raise ApiError(response.text, response.status_code if response.status_code >= 400 else 502) from exc

    if response.status_code >= 400:
        raise ApiError(data, response.status_code)

    return data
