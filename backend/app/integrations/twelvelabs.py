import json
import mimetypes
import os
import time
import uuid
from pathlib import Path

import requests

from app.core.config import REQUEST_TIMEOUT_SECONDS, TWELVELABS_BASE_URL, UPLOAD_TIMEOUT_SECONDS, twelvelabs_api_key
from app.core.errors import ApiError


UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024
DIRECT_UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024
CHUNK_UPLOAD_TIMEOUT_SECONDS = 180
MULTIPART_STATUS_ATTEMPTS = 60
MULTIPART_STATUS_INTERVAL_SECONDS = 10
PRESIGNED_URL_BATCH_SIZE = 50
CHUNK_UPLOAD_RETRY_ATTEMPTS = 4
CHUNK_UPLOAD_RETRY_INTERVAL_SECONDS = 2
ANALYZE_RETRY_ATTEMPTS = 2
ANALYZE_RETRY_INTERVAL_SECONDS = 5
INDEXED_ASSET_LIST_MAX_PAGES = 10
PEGASUS_SOURCE_VIDEO_METADATA_FIELD = "sports_jockey_pegasus_source_video_v2"


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
    attempts = ANALYZE_RETRY_ATTEMPTS if path == "/analyze" else 1
    for attempt in range(1, attempts + 1):
        try:
            response = requests.request(
                method,
                f"{TWELVELABS_BASE_URL}{path}",
                headers=json_headers(),
                json=payload,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            return parse_response(response)
        except requests.RequestException as exc:
            if attempt < attempts:
                time.sleep(ANALYZE_RETRY_INTERVAL_SECONDS)
                continue
            raise ApiError(str(exc), 502) from exc

    raise ApiError("TwelveLabs request failed", 502)


def request_form(method, path, fields):
    form_fields = []
    for key, value in fields:
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            for item in value:
                form_fields.append((key, (None, str(item))))
        else:
            form_fields.append((key, (None, str(value))))

    try:
        response = requests.request(
            method,
            f"{TWELVELABS_BASE_URL}{path}",
            headers=file_headers(),
            files=form_fields,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise ApiError(str(exc), 502) from exc

    return parse_response(response)


def create_response(payload):
    return request_json("post", "/responses", payload)


def analyze_video(payload):
    return request_json("post", "/analyze", payload)


def search_index(fields):
    return request_form("post", "/search", fields)


def create_knowledge_store(name, ingestion_config=None, metadata=None):
    payload = {"name": name}
    if ingestion_config is not None:
        payload["ingestion_config"] = ingestion_config
    if metadata is not None:
        payload["metadata"] = metadata
    return request_json("post", "/knowledge-stores", payload)


def add_knowledge_store_item(knowledge_store_id, asset_id):
    return request_json(
        "post",
        f"/knowledge-stores/{knowledge_store_id}/items",
        {"asset_id": asset_id},
    )


def get_knowledge_store_item(knowledge_store_id, item_id):
    return request_json("get", f"/knowledge-stores/{knowledge_store_id}/items/{item_id}")


def list_knowledge_store_items(knowledge_store_id):
    try:
        payload = request_json("get", f"/knowledge-stores/{knowledge_store_id}/items")
    except ApiError:
        return []
    items = payload.get("data") if isinstance(payload, dict) else payload
    return items if isinstance(items, list) else []


def delete_knowledge_store_item(knowledge_store_id, item_id):
    knowledge_store_id = clean_optional_string(knowledge_store_id)
    item_id = clean_optional_string(item_id)
    if not knowledge_store_id or not item_id:
        return
    if not item_id.startswith("ksi_"):
        item_id = f"ksi_{item_id}"
    try:
        request_json("delete", f"/knowledge-stores/{knowledge_store_id}/items/{item_id}")
    except ApiError as exc:
        if exc.status_code != 404:
            print(f"[cleanup] failed to delete knowledge store item {item_id}: {exc}", flush=True)


def get_asset(asset_id):
    return request_json("get", f"/assets/{asset_id}")


def asset_exists(asset_id):
    asset_id = clean_optional_string(asset_id)
    if not asset_id:
        return False
    try:
        get_asset(asset_id)
    except ApiError:
        return False
    return True


def asset_is_playable(asset_id):
    asset_id = clean_optional_string(asset_id)
    if not asset_id:
        return False
    try:
        asset = get_asset(asset_id)
    except ApiError:
        return False
    hls = asset.get("hls") or {}
    return bool(hls.get("manifest_url") and hls.get("status") == "ready")


def asset_duration_seconds(asset):
    if not isinstance(asset, dict):
        return None
    for key in ("duration", "duration_seconds", "video_duration", "video_duration_seconds"):
        duration = float_or_none(asset.get(key))
        if duration and duration > 0:
            return duration
    metadata = asset.get("metadata")
    if isinstance(metadata, dict):
        for key in ("duration", "duration_seconds", "video_duration", "video_duration_seconds"):
            duration = float_or_none(metadata.get(key))
            if duration and duration > 0:
                return duration
    return None


def list_asset_indexed_assets(asset_id):
    payload = request_json("get", f"/assets/{asset_id}/indexed-assets")
    data = payload.get("data") if isinstance(payload, dict) else None
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def add_indexed_asset(index_id, asset_id, enable_video_stream=True):
    return request_json(
        "post",
        f"/indexes/{index_id}/indexed-assets",
        {"asset_id": asset_id, "enable_video_stream": enable_video_stream},
    )


def get_indexed_asset(index_id, indexed_asset_id):
    return request_json("get", f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}")


def update_indexed_asset_user_metadata(index_id, indexed_asset_id, user_metadata):
    return request_json(
        "patch",
        f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}",
        {"user_metadata": user_metadata},
    )


def delete_indexed_asset(index_id, indexed_asset_id):
    index_id = clean_optional_string(index_id)
    indexed_asset_id = clean_optional_string(indexed_asset_id)
    if not index_id or not indexed_asset_id:
        return
    try:
        request_json("delete", f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}")
    except ApiError as exc:
        if exc.status_code != 404:
            print(f"[cleanup] failed to delete indexed asset {indexed_asset_id}: {exc}", flush=True)


def list_indexed_assets(index_id):
    indexed_assets = []
    page = 1
    while page <= INDEXED_ASSET_LIST_MAX_PAGES:
        path = f"/indexes/{index_id}/indexed-assets"
        if page > 1:
            path = f"{path}?page={page}"
        body = request_json("get", path)
        data = body.get("data")
        if isinstance(data, list):
            indexed_assets.extend(item for item in data if isinstance(item, dict))
        page_info = body.get("page_info") if isinstance(body.get("page_info"), dict) else {}
        total_pages = int(page_info.get("total_page") or page)
        if page >= total_pages:
            break
        page += 1
    return indexed_assets


def indexed_asset_with_user_metadata(index_id, indexed_asset):
    indexed_asset_id = response_id(indexed_asset)
    if not indexed_asset_id or indexed_asset_user_metadata(indexed_asset):
        return indexed_asset
    try:
        hydrated = get_indexed_asset(index_id, indexed_asset_id)
    except ApiError:
        return indexed_asset
    return hydrated if isinstance(hydrated, dict) else indexed_asset


def indexed_asset_for_reference(index_id, reference):
    reference = clean_optional_string(reference)
    if not reference:
        return None

    if "/" not in reference and "." not in reference:
        try:
            indexed_asset = get_indexed_asset(index_id, reference)
            if isinstance(indexed_asset, dict) and response_id(indexed_asset):
                return indexed_asset_with_user_metadata(index_id, indexed_asset)
        except ApiError:
            pass

    reference_values = indexed_asset_reference_values_for_text(reference)
    for indexed_asset in list_indexed_assets(index_id):
        hydrated = indexed_asset_with_user_metadata(index_id, indexed_asset)
        if indexed_asset_matches_reference(hydrated, reference_values):
            return hydrated
    return None


def indexed_asset_matches_reference(indexed_asset, reference_values):
    for value in indexed_asset_reference_values(indexed_asset):
        if value in reference_values:
            return True
    return False


def indexed_asset_reference_values(indexed_asset):
    values = []
    metadata = indexed_asset_user_metadata(indexed_asset)
    for value in (
        response_id(indexed_asset),
        indexed_asset_asset_id(indexed_asset),
        indexed_asset_filename(indexed_asset),
        indexed_asset_display_name(indexed_asset),
        clean_optional_string(metadata.get(PEGASUS_SOURCE_VIDEO_METADATA_FIELD)),
    ):
        values.extend(indexed_asset_reference_values_for_text(value))
    return set(values)


def indexed_asset_reference_values_for_text(value):
    value = clean_optional_string(value)
    if not value:
        return set()
    basename = Path(value).name
    stem = Path(basename).stem
    return {
        value,
        value.lower(),
        basename,
        basename.lower(),
        stem,
        stem.lower(),
    }


def indexed_asset_user_metadata(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return {}
    for key in ("user_metadata", "userMetadata"):
        metadata = indexed_asset.get(key)
        if isinstance(metadata, dict):
            return metadata
    metadata = indexed_asset.get("metadata")
    if isinstance(metadata, dict):
        for key in ("user_metadata", "userMetadata"):
            nested = metadata.get(key)
            if isinstance(nested, dict):
                return nested
    return {}


def indexed_asset_asset_id(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    asset_id = clean_optional_string(indexed_asset.get("asset_id")) or clean_optional_string(indexed_asset.get("assetId"))
    if asset_id:
        return asset_id
    asset = indexed_asset.get("asset")
    if isinstance(asset, dict):
        return response_id(asset) or clean_optional_string(asset.get("asset_id")) or clean_optional_string(asset.get("assetId"))
    return None


def indexed_asset_display_name(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    system_metadata = indexed_asset.get("system_metadata")
    if isinstance(system_metadata, dict):
        for key in ("name", "title", "filename"):
            value = clean_optional_string(system_metadata.get(key))
            if value:
                return value
    for key in ("name", "filename", "title"):
        value = clean_optional_string(indexed_asset.get(key))
        if value:
            return value
    asset = indexed_asset.get("asset")
    if isinstance(asset, dict):
        for key in ("filename", "name", "title"):
            value = clean_optional_string(asset.get(key))
            if value:
                return value
    return None


def indexed_asset_workspace_video_name(indexed_asset, fallback=None):
    metadata = indexed_asset_user_metadata(indexed_asset)
    return (
        clean_optional_string(metadata.get(PEGASUS_SOURCE_VIDEO_METADATA_FIELD))
        or indexed_asset_filename(indexed_asset)
        or indexed_asset_display_name(indexed_asset)
        or clean_optional_string(fallback)
        or response_id(indexed_asset)
        or indexed_asset_asset_id(indexed_asset)
        or "Indexed video"
    )


def indexed_asset_status(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    for key in ("status", "asset_status", "assetStatus"):
        value = clean_optional_string(indexed_asset.get(key))
        if value:
            return value
    asset = indexed_asset.get("asset")
    if isinstance(asset, dict):
        return clean_optional_string(asset.get("status"))
    return None


def indexed_asset_thumbnail_url(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    containers = [
        indexed_asset,
        indexed_asset.get("hls"),
        indexed_asset.get("metadata"),
        indexed_asset.get("system_metadata"),
    ]
    for container in containers:
        if not isinstance(container, dict):
            continue
        for key in ("thumbnail_url", "thumbnailUrl", "thumbnail", "thumbnail_urls", "thumbnailUrls", "thumbnails"):
            thumbnail_url = thumbnail_url_from_value(container.get(key))
            if thumbnail_url:
                return thumbnail_url
    asset = indexed_asset.get("asset")
    if isinstance(asset, dict):
        return indexed_asset_thumbnail_url(asset)
    return None


def thumbnail_url_from_value(value):
    if isinstance(value, str):
        return clean_optional_string(value)
    if isinstance(value, list):
        for item in value:
            thumbnail_url = thumbnail_url_from_value(item)
            if thumbnail_url:
                return thumbnail_url
    if isinstance(value, dict):
        for key in ("url", "src", "default", "thumbnail_url", "thumbnailUrl", "thumbnail_urls", "thumbnailUrls"):
            thumbnail_url = thumbnail_url_from_value(value.get(key))
            if thumbnail_url:
                return thumbnail_url
    return None


def indexed_asset_duration_seconds(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    for key in ("duration", "duration_seconds", "durationSeconds", "video_duration", "video_duration_seconds"):
        duration = float_or_none(indexed_asset.get(key))
        if duration and duration > 0:
            return duration
    system_metadata = indexed_asset.get("system_metadata")
    if isinstance(system_metadata, dict):
        for key in ("duration", "duration_seconds", "durationSeconds", "video_duration", "video_duration_seconds"):
            duration = float_or_none(system_metadata.get(key))
            if duration and duration > 0:
                return duration
    asset = indexed_asset.get("asset")
    if isinstance(asset, dict):
        return indexed_asset_duration_seconds(asset)
    return None


def indexed_asset_filename(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    system_metadata = indexed_asset.get("system_metadata")
    if isinstance(system_metadata, dict):
        filename = clean_optional_string(system_metadata.get("filename"))
        if filename:
            return filename
    return clean_optional_string(indexed_asset.get("filename")) or clean_optional_string(indexed_asset.get("name"))


def indexed_asset_index_id(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    index = indexed_asset.get("index")
    if isinstance(index, dict):
        return clean_optional_string(index.get("_id")) or clean_optional_string(index.get("id"))
    return clean_optional_string(indexed_asset.get("index_id")) or clean_optional_string(indexed_asset.get("indexId"))


def response_id(value):
    if not isinstance(value, dict):
        return None
    return clean_optional_string(value.get("_id")) or clean_optional_string(value.get("id"))


def parse_json_object(value):
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def clean_optional_string(value):
    if not isinstance(value, str):
        return None
    clean_value = value.strip()
    return clean_value or None


def float_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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
        sanitize_multipart_session(session)
        multipart_state["session"] = session
        multipart_state["completed_chunks"] = {}
        persist_state(on_state_change)
        if progress:
            progress(f"created multipart upload session {session['upload_id']} for {filename}")
    else:
        if sanitize_multipart_session(session):
            persist_state(on_state_change)
        if progress:
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
    response = None
    for attempt in range(1, CHUNK_UPLOAD_RETRY_ATTEMPTS + 1):
        try:
            response = requests.put(
                url,
                data=chunk,
                headers=upload_headers,
                timeout=(30, CHUNK_UPLOAD_TIMEOUT_SECONDS),
            )
        except requests.RequestException as exc:
            if attempt < CHUNK_UPLOAD_RETRY_ATTEMPTS:
                time.sleep(CHUNK_UPLOAD_RETRY_INTERVAL_SECONDS * attempt)
                continue
            raise ApiError(str(exc), 502) from exc
        if response.status_code < 500:
            break
        if attempt < CHUNK_UPLOAD_RETRY_ATTEMPTS:
            time.sleep(CHUNK_UPLOAD_RETRY_INTERVAL_SECONDS * attempt)

    if response is None:
        raise ApiError("chunk upload failed before response", 502)
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


def sanitize_multipart_session(session):
    if isinstance(session, dict) and "upload_urls" in session:
        session.pop("upload_urls", None)
        return True
    return False


def parse_response(response):
    if response.status_code == 204 or not response.content:
        if response.status_code >= 400:
            raise ApiError(response.text, response.status_code)
        return {}

    try:
        data = response.json()
    except ValueError as exc:
        if response.status_code < 400 and response.text.strip():
            return {"text": response.text}
        raise ApiError(response.text, response.status_code if response.status_code >= 400 else 502) from exc

    if response.status_code >= 400:
        raise ApiError(data, response.status_code)

    return data
