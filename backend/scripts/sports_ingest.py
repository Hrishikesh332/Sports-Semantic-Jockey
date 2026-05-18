import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = ROOT / "logs"
STATE_PATH = LOG_DIR / "sports_ingest_state.json"
GAME_TAG = "sports"
SOURCE_VIDEOS = [
    ROOT / "data/games/gamess/F1 2021 Monaco Race Replay.mp4",
    ROOT / "data/games/gamess/Arsenal vs Manchester United Full Match Jan 22 2023.mp4",
    ROOT / "more videos/Kansas vs Baylor Feb 26 2022.mp4",
    ROOT / "more videos/2022 All-Star Game Metropolitan vs Pacific 3-on-3.mp4",
    ROOT / "more videos/Villanova vs Baylor Dec 12 2021.mp4",
]
INDEX_VIDEOS = [
    {
        "path": ROOT / "data/games/gamess/f1_parts/F1 2021 Monaco Race Replay part 00.mp4",
        "source_name": "F1 2021 Monaco Race Replay.mp4",
        "offset_seconds": 0,
    },
    {
        "path": ROOT / "data/games/gamess/f1_parts/F1 2021 Monaco Race Replay part 01.mp4",
        "source_name": "F1 2021 Monaco Race Replay.mp4",
        "offset_seconds": 2160.5584,
    },
    {
        "path": ROOT / "data/games/gamess/f1_parts/F1 2021 Monaco Race Replay part 02.mp4",
        "source_name": "F1 2021 Monaco Race Replay.mp4",
        "offset_seconds": 4321.117402,
    },
    {
        "path": ROOT / "data/games/gamess/Arsenal vs Manchester United Full Match Jan 22 2023.mp4",
        "source_name": "Arsenal vs Manchester United Full Match Jan 22 2023.mp4",
        "offset_seconds": 0,
    },
    {
        "path": ROOT / "more videos/Kansas vs Baylor Feb 26 2022.mp4",
        "source_name": "Kansas vs Baylor Feb 26 2022.mp4",
        "offset_seconds": 0,
    },
    {
        "path": ROOT / "more videos/2022 All-Star Game Metropolitan vs Pacific 3-on-3.mp4",
        "source_name": "2022 All-Star Game Metropolitan vs Pacific 3-on-3.mp4",
        "offset_seconds": 0,
    },
    {
        "path": ROOT / "more videos/Villanova vs Baylor Dec 12 2021.mp4",
        "source_name": "Villanova vs Baylor Dec 12 2021.mp4",
        "offset_seconds": 0,
    },
]

sys.path.insert(0, str(ROOT))

from app.domain.highlights import SPORTS_HIGHLIGHT_INGESTION_SCHEMA
from app.services.games import register_game
from app.services.highlights import generate_highlight_reels


TWELVELABS_BASE_URL = "https://api.twelvelabs.io/v1.3"
HIGHLIGHT_CATEGORY_KEYS = [
    "standard_stats",
    "best_plays",
    "emotional_moments",
    "fan_experience",
    "behind_the_scenes",
]
ENHANCED_CATEGORY_KEYS = [
    "best_plays",
    "emotional_moments",
    "fan_experience",
    "behind_the_scenes",
]
UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024
UPLOAD_TIMEOUT_SECONDS = 6 * 60 * 60
CHUNK_UPLOAD_TIMEOUT_SECONDS = int(os.environ.get("SPORTS_INGEST_CHUNK_UPLOAD_TIMEOUT_SECONDS", "180"))
REQUEST_TIMEOUT_SECONDS = 120
DIRECT_UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024
PRESIGNED_URL_BATCH_SIZE = 50
UPLOAD_WORKERS = int(os.environ.get("SPORTS_INGEST_UPLOAD_WORKERS", "2"))
MULTIPART_STATUS_ATTEMPTS = int(os.environ.get("SPORTS_INGEST_MULTIPART_STATUS_ATTEMPTS", "60"))
MULTIPART_STATUS_INTERVAL_SECONDS = int(os.environ.get("SPORTS_INGEST_MULTIPART_STATUS_INTERVAL_SECONDS", "10"))
POLL_INTERVAL_SECONDS = int(os.environ.get("SPORTS_INGEST_POLL_INTERVAL_SECONDS", "60"))
POLL_ATTEMPTS = int(os.environ.get("SPORTS_INGEST_POLL_ATTEMPTS", "720"))


def main():
    load_env(ROOT / ".env")
    api_key = os.environ.get("TWELVELABS_API_KEY")
    if not api_key:
        raise SystemExit("TWELVELABS_API_KEY is required")

    for video in SOURCE_VIDEOS:
        if not video.exists():
            raise SystemExit(f"video not found: {video}")
    for spec in INDEX_VIDEOS:
        if not spec["path"].exists():
            raise SystemExit(f"index video not found: {spec['path']}")
    ensure_video_links(SOURCE_VIDEOS)

    LOG_DIR.mkdir(exist_ok=True)
    state = load_state()
    state.setdefault("created_at", timestamp())
    state["source_videos"] = [video.name for video in SOURCE_VIDEOS]
    state["index_videos"] = [
        {
            "name": spec["path"].name,
            "source_name": spec["source_name"],
            "offset_seconds": spec["offset_seconds"],
        }
        for spec in INDEX_VIDEOS
    ]
    state.setdefault("asset_ids", {})
    state.setdefault("item_ids", {})
    state.setdefault("item_statuses", {})

    store_id = state.get("knowledge_store_id")
    if not store_id:
        store = create_knowledge_store(api_key)
        store_id = store["_id"]
        state["knowledge_store_id"] = store_id
        state["knowledge_store"] = store
        save_state(state)
        print_status(f"created knowledge store {store_id}")
    else:
        print_status(f"using existing knowledge store {store_id}")

    for spec in INDEX_VIDEOS:
        video = spec["path"]
        if video.name in state["asset_ids"]:
            print_status(f"asset already uploaded for {video.name}: {state['asset_ids'][video.name]}")
            continue
        asset = upload_asset(api_key, video, state)
        state["asset_ids"][video.name] = asset["_id"]
        state.setdefault("assets", {})[video.name] = asset
        save_state(state)
        print_status(f"uploaded asset {asset['_id']} for {video.name}")

    for spec in INDEX_VIDEOS:
        video = spec["path"]
        if video.name in state["item_ids"]:
            print_status(f"item already added for {video.name}: {state['item_ids'][video.name]}")
            continue
        item = add_knowledge_store_item(api_key, store_id, state["asset_ids"][video.name])
        state["item_ids"][video.name] = item["_id"]
        state.setdefault("items", {})[video.name] = item
        state["item_statuses"][video.name] = item.get("status", "unknown")
        save_state(state)
        print_status(f"added item {item['_id']} for {video.name}")

    poll_items_until_ready(api_key, store_id, state)

    if any(status != "ready" for status in state["item_statuses"].values()):
        print_status("not all items are ready yet; rerun this script to resume polling")
        return

    video_reference_map = build_video_reference_map(state, INDEX_VIDEOS)
    video_reference_offsets = build_video_reference_offsets(state, INDEX_VIDEOS)
    game = register_game(
        {
            "tag": GAME_TAG,
            "label": "Sports",
            "sport": "Sports",
            "knowledge_store_id": store_id,
            "source_videos": [video.name for video in SOURCE_VIDEOS],
            "video_reference_map": video_reference_map,
        }
    )
    state["registered_game"] = game
    save_state(state)
    print_status("registered Sports game with real TwelveLabs knowledge store")

    highlight_response_logs = state.setdefault("highlight_response_logs", {})
    for source_video in SOURCE_VIDEOS:
        if not should_generate_video_highlights(state, source_video.name):
            print_status(f"highlight response already generated for {source_video.name}: {highlight_response_logs[source_video.name]}")
            continue
        reels = generate_highlight_reels(
            knowledge_store_id=store_id,
            match_context=single_video_match_context(source_video.name),
        )
        reels = normalize_reel_references(reels, video_reference_map, video_reference_offsets)
        reels = filter_reels_to_source(reels, source_video.name)
        log_name = f"{timestamp()}_{slugify(source_video.stem)}_highlight_reels.json"
        (LOG_DIR / log_name).write_text(json.dumps(reels, indent=2, ensure_ascii=False))
        highlight_response_logs[source_video.name] = log_name
        state["highlight_response_logs"] = highlight_response_logs
        save_state(state)
        print_status(f"generated Jockey highlight response for {source_video.name}: {log_name}")

    game["highlight_response_logs"] = highlight_response_logs
    state["registered_game"] = register_game(game)
    save_state(state)
    print_status("registered per-video Sports highlight responses")


def ensure_video_links(source_videos):
    videos_dir = ROOT / "data" / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)
    for video in source_videos:
        link_path = videos_dir / video.name
        if link_path.exists() or link_path.is_symlink():
            continue
        link_path.symlink_to(os.path.relpath(video, link_path.parent))
        print_status(f"linked local media for {video.name}")


def create_knowledge_store(api_key):
    return request_json(
        api_key,
        "post",
        "/knowledge-stores",
        {
            "name": f"Sports Knowledge Base {timestamp()}",
            "ingestion_config": {
                "enrichment_config": {
                    "type": "json_schema",
                    "json_schema": SPORTS_HIGHLIGHT_INGESTION_SCHEMA,
                }
            },
            "metadata": {"game_tag": GAME_TAG, "source": "sports-jockey"},
        },
    )


def upload_asset(api_key, video, state):
    if video.stat().st_size > DIRECT_UPLOAD_LIMIT_BYTES:
        return upload_asset_multipart(api_key, video, state)
    return upload_asset_direct(api_key, video)


def upload_asset_direct(api_key, video):
    boundary = f"sportsjockey-{uuid.uuid4().hex}"
    content_type = mimetypes.guess_type(video.name)[0] or "application/octet-stream"
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
        f'Content-Disposition: form-data; name="file"; filename="{video.name}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode()
    ending = f"\r\n--{boundary}--\r\n".encode()
    content_length = len(preamble) + video.stat().st_size + len(ending)

    def body():
        uploaded = 0
        next_report = 512 * 1024 * 1024
        yield preamble
        with video.open("rb") as handle:
            while True:
                chunk = handle.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                uploaded += len(chunk)
                if uploaded >= next_report:
                    print_status(f"uploaded {uploaded / (1024 ** 3):.1f} GB of {video.name}")
                    next_report += 512 * 1024 * 1024
                yield chunk
        yield ending

    print_status(f"uploading {video.name} ({video.stat().st_size / (1024 ** 3):.2f} GB)")
    try:
        response = requests.post(
            f"{TWELVELABS_BASE_URL}/assets",
            headers={
                "x-api-key": api_key,
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(content_length),
            },
            data=body(),
            timeout=(30, UPLOAD_TIMEOUT_SECONDS),
        )
    except requests.RequestException as exc:
        raise SystemExit(f"asset upload failed for {video.name}: {exc}") from exc
    return parse_response(response)


def upload_asset_multipart(api_key, video, state):
    multipart_state = state.setdefault("multipart_uploads", {}).setdefault(video.name, {})
    session = multipart_state.get("session")
    if not session:
        session = request_json(
            api_key,
            "post",
            "/assets/multipart-uploads",
            {
                "filename": video.name,
                "type": "video",
                "total_size": video.stat().st_size,
                "enable_hls": True,
                "enable_thumbnail": True,
            },
        )
        multipart_state["session"] = session
        multipart_state["completed_chunks"] = {}
        save_state(state)
        print_status(f"created multipart upload session {session['upload_id']} for {video.name}")
    else:
        print_status(f"resuming multipart upload session {session['upload_id']} for {video.name}")

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
        upload_urls = request_presigned_urls(api_key, upload_id, batch_start, len(batch_chunks))
        missing_urls = [chunk for chunk in batch_chunks if chunk not in upload_urls]
        for chunk in missing_urls:
            upload_urls.update(request_presigned_urls(api_key, upload_id, chunk, 1))
        missing_urls = [chunk for chunk in batch_chunks if chunk not in upload_urls]
        if missing_urls:
            raise SystemExit(f"missing presigned URLs for chunks: {missing_urls[:10]}")

        print_status(
            f"uploading chunks {batch_chunks[0]}-{batch_chunks[-1]} "
            f"for {video.name} with {UPLOAD_WORKERS} workers"
        )
        with ThreadPoolExecutor(max_workers=UPLOAD_WORKERS) as executor:
            futures = {
                executor.submit(
                    upload_chunk,
                    video,
                    chunk_size,
                    chunk_index,
                    chunk_length_for(video, chunk_size, chunk_index),
                    upload_urls[chunk_index],
                    upload_headers,
                ): chunk_index
                for chunk_index in batch_chunks
            }
            for future in as_completed(futures):
                chunk_index = futures[future]
                chunk_length = chunk_length_for(video, chunk_size, chunk_index)
                etag = future.result()
                completed_chunk = {
                    "chunk_index": chunk_index,
                    "proof": etag,
                    "proof_type": "etag",
                    "chunk_size": chunk_length,
                }
                report_uploaded_chunks(api_key, upload_id, [completed_chunk])
                completed_chunks[str(chunk_index)] = completed_chunk
                save_state(state)
                uploaded_count = len(completed_chunks)
                if uploaded_count == 1 or uploaded_count == total_chunks or uploaded_count % 25 == 0:
                    print_status(f"uploaded {uploaded_count}/{total_chunks} chunks for {video.name}")

    status = wait_for_multipart_completion(api_key, upload_id)
    multipart_state["status"] = status
    save_state(state)
    if status.get("status") != "completed":
        raise SystemExit(f"multipart upload not completed for {video.name}: {json.dumps(status, ensure_ascii=False)}")

    return {"_id": asset_id, "method": "multipart", "status": "ready", "filename": video.name}


def request_presigned_urls(api_key, upload_id, start, count):
    response = request_json(
        api_key,
        "post",
        f"/assets/multipart-uploads/{upload_id}/presigned-urls",
        {"start": start, "count": count},
    )
    return {int(entry["chunk_index"]): entry["url"] for entry in response.get("upload_urls", [])}


def upload_chunk(video, chunk_size, chunk_index, chunk_length, url, upload_headers):
    offset = (chunk_index - 1) * chunk_size
    with video.open("rb") as handle:
        handle.seek(offset)
        chunk = handle.read(chunk_length)
    try:
        response_headers = upload_chunk_with_curl(chunk, chunk_index, url, upload_headers)
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"chunk upload failed for {video.name} chunk {chunk_index}: {exc}") from exc
    etag = response_headers.get("etag")
    if not etag:
        raise RuntimeError(f"chunk upload response missing ETag for {video.name} chunk {chunk_index}")
    return etag.strip('"')


def upload_chunk_with_curl(chunk, chunk_index, url, upload_headers):
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=f"sports-upload-{chunk_index}-",
            suffix=".part",
            dir=LOG_DIR,
            delete=False,
        ) as temp_file:
            temp_file.write(chunk)
            temp_path = temp_file.name

        command = [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            str(CHUNK_UPLOAD_TIMEOUT_SECONDS),
            "--dump-header",
            "-",
            "--output",
            "/dev/null",
            "--request",
            "PUT",
            "--upload-file",
            temp_path,
        ]
        for key, value in upload_headers.items():
            command.extend(["--header", f"{key}: {value}"])
        command.append(url)
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=CHUNK_UPLOAD_TIMEOUT_SECONDS + 30,
            check=False,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise subprocess.CalledProcessError(result.returncode, command, output=result.stdout, stderr=detail)
        return parse_headers(result.stdout)
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass


def parse_headers(raw_headers):
    parsed = {}
    for line in raw_headers.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        parsed[key.strip().lower()] = value.strip()
    return parsed


def report_uploaded_chunks(api_key, upload_id, chunks):
    return request_json(
        api_key,
        "post",
        f"/assets/multipart-uploads/{upload_id}",
        {"completed_chunks": chunks},
    )


def get_multipart_status(api_key, upload_id):
    return request_json(api_key, "get", f"/assets/multipart-uploads/{upload_id}")


def wait_for_multipart_completion(api_key, upload_id):
    for attempt in range(1, MULTIPART_STATUS_ATTEMPTS + 1):
        status = get_multipart_status(api_key, upload_id)
        if status.get("status") == "completed":
            return status
        if status.get("chunks_failed"):
            raise SystemExit(f"multipart upload has failed chunks: {json.dumps(status, ensure_ascii=False)}")
        print_status(
            f"multipart upload {upload_id}: {status.get('status', 'unknown')} "
            f"({status.get('chunks_completed', 0)} chunks completed), "
            f"attempt {attempt}/{MULTIPART_STATUS_ATTEMPTS}"
        )
        time.sleep(MULTIPART_STATUS_INTERVAL_SECONDS)
    return status


def chunk_length_for(video, chunk_size, chunk_index):
    offset = (chunk_index - 1) * chunk_size
    return min(chunk_size, video.stat().st_size - offset)


def add_knowledge_store_item(api_key, store_id, asset_id):
    return request_json(api_key, "post", f"/knowledge-stores/{store_id}/items", {"asset_id": asset_id})


def poll_items_until_ready(api_key, store_id, state):
    for attempt in range(1, POLL_ATTEMPTS + 1):
        pending = []
        for video_name, item_id in state["item_ids"].items():
            current_status = state["item_statuses"].get(video_name)
            if current_status == "ready":
                continue
            item = request_json(api_key, "get", f"/knowledge-stores/{store_id}/items/{item_id}")
            status = item.get("status", "unknown")
            state["item_statuses"][video_name] = status
            state.setdefault("item_status_bodies", {})[video_name] = item
            if status not in {"ready", "failed"}:
                pending.append(video_name)
            print_status(f"item {item_id} for {video_name}: {status}")
        save_state(state)
        if any(status == "failed" for status in state["item_statuses"].values()):
            raise SystemExit("one or more knowledge store items failed indexing")
        if not pending:
            return
        print_status(f"waiting {POLL_INTERVAL_SECONDS}s for indexing, attempt {attempt}/{POLL_ATTEMPTS}")
        time.sleep(POLL_INTERVAL_SECONDS)


def request_json(api_key, method, path, payload=None):
    try:
        response = requests.request(
            method,
            f"{TWELVELABS_BASE_URL}{path}",
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise SystemExit(f"TwelveLabs request failed: {exc}") from exc
    return parse_response(response)


def parse_response(response):
    try:
        data = response.json()
    except ValueError as exc:
        raise SystemExit(f"TwelveLabs returned non-JSON response ({response.status_code}): {response.text}") from exc
    if response.status_code >= 400:
        raise SystemExit(f"TwelveLabs request failed ({response.status_code}): {json.dumps(data, ensure_ascii=False)}")
    return data


def build_video_reference_map(state, index_videos):
    mapping = {}
    specs = {spec["path"].name: spec for spec in index_videos}
    for video_name, item_id in state["item_ids"].items():
        source_name = specs.get(video_name, {}).get("source_name", video_name)
        mapping[video_name] = source_name
        asset_id = state.get("asset_ids", {}).get(video_name)
        if asset_id:
            mapping[asset_id] = source_name
        mapping[item_id] = source_name
        if item_id.startswith("ksi_"):
            mapping[item_id.removeprefix("ksi_")] = source_name
    return mapping


def build_video_reference_offsets(state, index_videos):
    offsets = {}
    specs = {spec["path"].name: spec for spec in index_videos}
    for video_name, item_id in state["item_ids"].items():
        offset = specs.get(video_name, {}).get("offset_seconds", 0)
        offsets[video_name] = offset
        asset_id = state.get("asset_ids", {}).get(video_name)
        if asset_id:
            offsets[asset_id] = offset
        offsets[item_id] = offset
        if item_id.startswith("ksi_"):
            offsets[item_id.removeprefix("ksi_")] = offset
    return offsets


def normalize_reel_references(reels, video_reference_map, video_reference_offsets):
    for category in [
        "standard_stats",
        "best_plays",
        "emotional_moments",
        "fan_experience",
        "behind_the_scenes",
    ]:
        clips = reels.get(category, {}).get("clips", [])
        for clip in clips:
            reference = clip.get("video_reference")
            if not reference:
                continue
            offset = video_reference_offsets.get(reference, 0)
            if offset:
                clip["start_time"] = shift_timecode(clip.get("start_time", ""), offset)
                clip["end_time"] = shift_timecode(clip.get("end_time", ""), offset)
            clip["video_reference"] = video_reference_map.get(reference, reference)
    return reels


def filter_reels_to_source(reels, source_name):
    reels["match_summary"] = f"{source_name} scoped highlight reel."
    for category in [
        "standard_stats",
        "best_plays",
        "emotional_moments",
        "fan_experience",
        "behind_the_scenes",
    ]:
        category_body = reels.get(category, {})
        category_body["clips"] = [
            clip
            for clip in category_body.get("clips", [])
            if clip.get("video_reference") == source_name
        ]
        notes = category_body.get("assembly_notes", [])
        category_body["assembly_notes"] = [
            note
            for note in notes
            if isinstance(note, str) and source_name.lower() in note.lower()
        ]
    return reels


def shift_timecode(value, offset_seconds):
    seconds = timecode_to_seconds(value)
    if seconds is None:
        return value
    return seconds_to_timecode(seconds + offset_seconds)


def timecode_to_seconds(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        total = 0.0
        for part in value.strip().split(":"):
            total = total * 60 + float(part)
        return total
    except ValueError:
        return None


def seconds_to_timecode(total_seconds):
    total = max(0, int(round(total_seconds)))
    hours = total // 3600
    minutes = (total % 3600) // 60
    seconds = total % 60
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def should_generate_video_highlights(state, source_name):
    log_name = state.get("highlight_response_logs", {}).get(source_name)
    if not log_name:
        return True
    log_path = LOG_DIR / log_name
    if not log_path.exists():
        return True
    reels = json.loads(log_path.read_text())
    invalid_confidences = invalid_reel_confidences(reels)
    if invalid_confidences:
        preview = ", ".join(invalid_confidences[:6])
        if len(invalid_confidences) > 6:
            preview = f"{preview}, ..."
        print_status(f"regenerating Jockey response for {source_name}; found unusable confidence values: {preview}")
        return True
    coverage_issue = timeline_coverage_issue(reels)
    if coverage_issue:
        print_status(f"regenerating Jockey response for {source_name}; {coverage_issue}")
        return True
    references = clip_references(reels)
    leaked_sources = sorted(reference for reference in references if reference != source_name)
    if leaked_sources:
        print_status(f"regenerating Jockey response for {source_name}; found non-video references: {', '.join(leaked_sources)}")
        return True
    return False


def invalid_reel_confidences(reels):
    invalid = []
    for category in HIGHLIGHT_CATEGORY_KEYS:
        for index, clip in enumerate(reels.get(category, {}).get("clips", [])):
            confidence = clip.get("confidence")
            if not isinstance(confidence, (int, float)) or confidence <= 0 or confidence > 1:
                invalid.append(f"{category}[{index}]={confidence!r}")
    return invalid


def timeline_coverage_issue(reels):
    standard_end = max_category_end_seconds(reels, "standard_stats")
    enhanced_end = max(max_category_end_seconds(reels, category) for category in ENHANCED_CATEGORY_KEYS)
    if standard_end < 45 * 60 or enhanced_end <= 0:
        return None
    if enhanced_end < standard_end * 0.55:
        return (
            "enhanced lanes stop too early for a full-match timeline "
            f"(enhanced through {seconds_to_timecode(enhanced_end)}, event feed through {seconds_to_timecode(standard_end)})"
        )
    return None


def max_category_end_seconds(reels, category):
    return max(
        [
            timecode_to_seconds(clip.get("end_time", "")) or 0
            for clip in reels.get(category, {}).get("clips", [])
        ]
        or [0]
    )


def clip_references(reels):
    return {
        clip.get("video_reference")
        for category in HIGHLIGHT_CATEGORY_KEYS
        for clip in reels.get(category, {}).get("clips", [])
        if clip.get("video_reference")
    }


def single_video_match_context(source_name):
    extra = ""
    if source_name == "F1 2021 Monaco Race Replay.mp4":
        extra = (
            " The F1 replay is indexed as three sequential parts because of the knowledge store media size limit; "
            "treat those parts as this one continuous source video."
        )
    return (
        f"Sports knowledge base request for the single source video named {source_name}. "
        f"Use only evidence from {source_name}: clips, timestamps, teams, players, score context, crowd moments, "
        "emotions, and broadcast details must all come from that one video. Do not create a collective reel, "
        "do not balance across videos, and do not compare or blend facts with any other video in the knowledge store."
        f"{extra}"
    )


def slugify(value):
    slug = "".join(character.lower() if character.isalnum() else "-" for character in value)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-") or "video"


def load_env(path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


def load_state():
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {}


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2, ensure_ascii=False))


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def print_status(message):
    print(f"[{timestamp()}] {message}", flush=True)


if __name__ == "__main__":
    main()
