import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FOLDER = ROOT / "videosss"
DEFAULT_PREPARED_FOLDER = ROOT / "data" / "videosss_prepared"
DEFAULT_STATE_PATH = ROOT / "data" / "videosss_ingest_state.json"
DEFAULT_TAG = "sports"
DEFAULT_BACKEND_URL = "http://127.0.0.1:5000"
DEFAULT_MAX_DURATION_SECONDS = 120 * 60
DEFAULT_SEGMENT_DURATION_SECONDS = 118 * 60
DEFAULT_MAX_UPLOAD_BYTES = 2_200_000_000
DEFAULT_TARGET_UPLOAD_BYTES = 2_100_000_000

sys.path.insert(0, str(ROOT))

from app.core.errors import ApiError


def main():
    args = parse_args()
    load_env(ROOT / ".env")
    state = load_state(args.state_path)
    folder = args.folder.resolve()
    videos = list_source_videos(folder)
    if not videos:
        raise SystemExit(f"No MP4 files found in {folder}")

    ensure_backend_ready(args.backend_url)
    game = fetch_game(args.backend_url, args.tag)
    knowledge_store_id = game["knowledge_store_id"]
    index_id = game.get("marengo_index_id") or os.environ.get("INDEX_ID")
    state.setdefault("tag", args.tag)
    state.setdefault("knowledge_store_id", knowledge_store_id)
    state.setdefault("index_id", index_id)
    state.setdefault("videos", {})
    save_state(args.state_path, state)

    progress(f"using backend {args.backend_url}, game {args.tag}, knowledge store {knowledge_store_id}, index {index_id}")
    progress(f"found {len(videos)} source mp4 files in {folder}")

    for path in videos:
        game = fetch_game(args.backend_url, args.tag)
        if source_already_registered(game, path.name):
            progress(f"skipping {path.name}; already registered in workspace")
            continue
        segments = prepare_upload_segments(
            path=path,
            prepared_folder=args.prepared_folder,
            max_duration_seconds=args.max_duration_seconds,
            segment_duration_seconds=args.segment_duration_seconds,
            max_upload_bytes=args.max_upload_bytes,
            target_upload_bytes=args.target_upload_bytes,
        )
        progress(f"{path.name}: {len(segments)} upload segment(s)")
        for upload_path, upload_name in segments:
            game = fetch_game(args.backend_url, args.tag)
            if segment_already_registered(game, upload_name):
                progress(f"skipping {upload_name}; already registered in workspace")
                continue
            ingest_segment(
                tag=args.tag,
                source_name=path.name,
                upload_path=upload_path,
                upload_name=upload_name,
                state=state,
                state_path=args.state_path,
                backend_url=args.backend_url,
                poll_item=args.poll_items,
            )

    progress("finished videosss upload + knowledge-store + index registration")
    print(json.dumps(summary(state), indent=2, ensure_ascii=False))


def parse_args():
    parser = argparse.ArgumentParser(description="Upload backend/videosss MP4s via POST /games/<tag>/upload.")
    parser.add_argument("--folder", type=Path, default=DEFAULT_FOLDER)
    parser.add_argument("--prepared-folder", type=Path, default=DEFAULT_PREPARED_FOLDER)
    parser.add_argument("--state-path", type=Path, default=DEFAULT_STATE_PATH)
    parser.add_argument("--tag", default=DEFAULT_TAG)
    parser.add_argument("--backend-url", default=DEFAULT_BACKEND_URL)
    parser.add_argument("--max-duration-seconds", type=int, default=DEFAULT_MAX_DURATION_SECONDS)
    parser.add_argument("--segment-duration-seconds", type=int, default=DEFAULT_SEGMENT_DURATION_SECONDS)
    parser.add_argument("--max-upload-bytes", type=int, default=DEFAULT_MAX_UPLOAD_BYTES)
    parser.add_argument("--target-upload-bytes", type=int, default=DEFAULT_TARGET_UPLOAD_BYTES)
    parser.add_argument("--poll-items", action="store_true", help="Poll knowledge-store items until ready.")
    return parser.parse_args()


def source_already_registered(game, source_name):
    return source_name in game.get("video_asset_ids", {})


def segment_already_registered(game, upload_name):
    return upload_name in game.get("video_asset_ids", {})


def list_source_videos(folder):
    all_mp4 = sorted(folder.glob("*.mp4"))
    result = []
    for path in all_mp4:
        if path.name.endswith(".original.mp4"):
            base_name = path.name[: -len(".original.mp4")] + ".mp4"
            if (folder / base_name).exists():
                continue
        result.append(path)
    return result


def prepare_upload_segments(
    path,
    prepared_folder,
    max_duration_seconds,
    segment_duration_seconds,
    max_upload_bytes,
    target_upload_bytes,
):
    prepared_folder.mkdir(parents=True, exist_ok=True)
    duration = media_duration_seconds(path)
    source_size = path.stat().st_size

    if duration <= max_duration_seconds:
        progress(
            f"{path.name}: {format_minutes(duration)}, {format_size(source_size)} — "
            f"no chunking needed (<= {max_duration_seconds / 60:.0f} min)"
        )
        upload_path = finalize_upload_file(
            source_path=path,
            output_path=prepared_folder / path.name,
            max_upload_bytes=max_upload_bytes,
            target_upload_bytes=target_upload_bytes,
        )
        return [(upload_path, path.name)]

    progress(
        f"{path.name}: {format_minutes(duration)}, {format_size(source_size)} — "
        f"splitting into {segment_duration_seconds / 60:.0f} min chunks"
    )
    segments = []
    start = 0.0
    part = 1
    while start < duration - 0.5:
        segment_duration = min(segment_duration_seconds, duration - start)
        part_name = f"{path.stem} - Part {part}{path.suffix}"
        segment_path = prepared_folder / part_name
        ensure_segment_file(path, start, segment_duration, segment_path)
        upload_path = finalize_upload_file(
            source_path=segment_path,
            output_path=segment_path,
            max_upload_bytes=max_upload_bytes,
            target_upload_bytes=target_upload_bytes,
        )
        segments.append((upload_path, part_name))
        start += segment_duration
        part += 1
    return segments


def ensure_segment_file(source_path, start_seconds, duration_seconds, output_path):
    if segment_ready(output_path, duration_seconds):
        progress(
            f"chunk already exists for {output_path.name}: "
            f"{format_size(output_path.stat().st_size)}, {format_minutes(media_duration_seconds(output_path))}; "
            f"skipping extraction"
        )
        return output_path
    extract_segment(source_path, start_seconds, duration_seconds, output_path)
    return output_path


def finalize_upload_file(source_path, output_path, max_upload_bytes, target_upload_bytes):
    size = source_path.stat().st_size
    if size <= max_upload_bytes:
        if source_path.resolve() != output_path.resolve():
            output_path.parent.mkdir(parents=True, exist_ok=True)
            if not output_path.exists():
                subprocess.run(["cp", str(source_path), str(output_path)], check=True)
            progress(
                f"{output_path.name}: {format_size(size)} — within {format_size(max_upload_bytes)} limit; "
                f"skipping compression"
            )
            return output_path
        progress(
            f"{source_path.name}: {format_size(size)} — within {format_size(max_upload_bytes)} limit; "
            f"skipping compression"
        )
        return source_path

    if compressed_file_ready(output_path, max_upload_bytes):
        progress(
            f"compressed chunk already exists for {output_path.name}: "
            f"{format_size(output_path.stat().st_size)}; skipping compression"
        )
        return output_path

    progress(
        f"{source_path.name}: {format_size(size)} > {format_size(max_upload_bytes)} limit — compressing"
    )
    return compress_upload_file(
        source_path=source_path,
        output_path=output_path,
        max_upload_bytes=max_upload_bytes,
        target_upload_bytes=target_upload_bytes,
    )


def compressed_file_ready(output_path, max_upload_bytes):
    if not output_path.exists() or output_path.stat().st_size > max_upload_bytes:
        return False
    try:
        validate_media_file(output_path)
    except ApiError:
        progress(f"existing chunk failed validation for {output_path.name}; will rebuild")
        return False
    return True


def compress_upload_file(source_path, output_path, max_upload_bytes, target_upload_bytes):
    compressed_path = output_path.with_suffix(output_path.suffix + ".compressed.mp4")
    duration = media_duration_seconds(source_path)
    video_bitrate = target_video_bitrate(duration, target_upload_bytes)
    temporary_path = compressed_path.with_suffix(compressed_path.suffix + ".tmp.mp4")
    if temporary_path.exists():
        temporary_path.unlink()
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        f"{video_bitrate}k",
        "-maxrate",
        f"{max(video_bitrate, int(video_bitrate * 1.2))}k",
        "-bufsize",
        f"{max(video_bitrate * 2, 600)}k",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(temporary_path),
    ]
    subprocess.run(command, check=True)
    validate_media_file(temporary_path)
    if temporary_path.stat().st_size > max_upload_bytes:
        temporary_path.unlink()
        raise ApiError(
            {
                "message": "compressed segment is still above upload limit",
                "video": source_path.name,
                "prepared_size_bytes": temporary_path.stat().st_size,
                "max_upload_bytes": max_upload_bytes,
            },
            413,
        )

    temporary_path.replace(compressed_path)
    if output_path.exists() and output_path.resolve() != compressed_path.resolve():
        backup_path = output_path.with_suffix(output_path.suffix + ".uncompressed.mp4")
        if backup_path.exists():
            backup_path.unlink()
        output_path.replace(backup_path)
    compressed_path.replace(output_path)
    progress(f"compressed {source_path.name} to {format_size(output_path.stat().st_size)}")
    return output_path


def validate_media_file(path):
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise ApiError(
            {
                "message": "prepared media failed validation",
                "video": path.name,
                "detail": (completed.stderr or completed.stdout or "ffprobe failed").strip(),
            },
            500,
        )
    if "video" not in completed.stdout:
        raise ApiError(f"prepared media has no video stream: {path.name}", 500)


def segment_ready(path, duration_seconds):
    if not path.exists() or path.stat().st_size <= 0:
        return False
    try:
        validate_media_file(path)
    except ApiError:
        return False
    actual_duration = media_duration_seconds(path)
    return abs(actual_duration - duration_seconds) <= max(5.0, duration_seconds * 0.02)


def extract_segment(source_path, start_seconds, duration_seconds, output_path):
    progress(
        f"extracting segment from {source_path.name}: "
        f"{format_minutes(start_seconds)} + {format_minutes(duration_seconds)}"
    )
    temporary_path = output_path.with_suffix(output_path.suffix + ".tmp.mp4")
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-i",
        str(source_path),
        "-t",
        f"{duration_seconds:.3f}",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        str(temporary_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        progress(f"stream copy failed for {source_path.name}; re-encoding segment")
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{start_seconds:.3f}",
            "-i",
            str(source_path),
            "-t",
            f"{duration_seconds:.3f}",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(temporary_path),
        ]
        subprocess.run(command, check=True)
    temporary_path.replace(output_path)
    progress(
        f"extracted chunk {output_path.name}: "
        f"{format_size(output_path.stat().st_size)}, {format_minutes(media_duration_seconds(output_path))}"
    )


def format_size(size_bytes):
    return f"{size_bytes / (1000 ** 3):.2f} GB"


def ingest_segment(tag, source_name, upload_path, upload_name, state, state_path, backend_url, poll_item):
    state_key = f"{source_name}::{upload_name}"
    video_state = state["videos"].setdefault(
        state_key,
        {
            "source_name": source_name,
            "upload_name": upload_name,
            "path": str(upload_path),
        },
    )
    video_state["path"] = str(upload_path)
    video_state["upload_name"] = upload_name
    save_state(state_path, state)

    registered_name = video_state.get("registered_video_name")
    asset_id = video_state.get("asset_id")
    if not asset_id:
        progress(f"uploading {upload_name} via POST /games/{tag}/upload ({upload_path.stat().st_size / (1024 ** 3):.2f} GB)")
        result = upload_via_backend(backend_url, tag, upload_path, upload_name)
        asset_id = result.get("asset_id")
        registered_name = result.get("video_name", upload_name)
        if not asset_id:
            raise ApiError(f"Upload response missing asset_id for {upload_name}", 502)
        video_state["asset_id"] = asset_id
        video_state["registered_video_name"] = registered_name
        video_state["upload_response"] = result
        save_state(state_path, state)
        progress(f"upload accepted for {registered_name}: asset {asset_id}")

    wait_for_backend_registration(
        backend_url=backend_url,
        tag=tag,
        registered_name=registered_name or upload_name,
        asset_id=asset_id,
        video_state=video_state,
        state=state,
        state_path=state_path,
        poll_item=poll_item,
    )


def upload_via_backend(backend_url, tag, path, filename):
    url = f"{backend_url.rstrip('/')}/games/{tag}/upload"
    last_error = None
    for attempt in range(1, 6):
        try:
            with path.open("rb") as handle:
                response = requests.post(
                    url,
                    data={"method": "direct"},
                    files={"file": (filename, handle, "video/mp4")},
                    timeout=7200,
                )
            if response.status_code >= 400:
                raise ApiError(response.text or f"upload failed with status {response.status_code}", response.status_code)
            return response.json()
        except (requests.RequestException, ApiError) as exc:
            last_error = exc
            if attempt == 5 or not is_retryable_upload_error(exc):
                raise
            wait_seconds = min(60, 5 * attempt)
            progress(f"upload attempt {attempt} failed for {filename}; retrying in {wait_seconds}s ({exc})")
            time.sleep(wait_seconds)
    raise ApiError(str(last_error), 502)


def is_retryable_upload_error(error):
    text = str(error).lower()
    return any(
        marker in text
        for marker in (
            "ssleoferror",
            "ssl",
            "connection",
            "timeout",
            "temporarily unavailable",
            "bad request",
            "400",
            "502",
            "503",
            "504",
        )
    )


def wait_for_backend_registration(
    backend_url,
    tag,
    registered_name,
    asset_id,
    video_state,
    state,
    state_path,
    poll_item,
):
    if video_state.get("registered"):
        return

    for attempt in range(1, 361):
        game = fetch_game(backend_url, tag)
        video_asset_ids = game.get("video_asset_ids", {})
        marengo_video_ids = game.get("marengo_video_ids", {})
        indexed_asset_id = marengo_video_ids.get(registered_name)
        if indexed_asset_id and video_asset_ids.get(registered_name) == asset_id:
            video_state["indexed_asset_id"] = indexed_asset_id
            video_state["registered"] = True
            save_state(state_path, state)
            progress(f"registered {registered_name} in workspace (indexed asset {indexed_asset_id})")
            return
        if attempt == 1 or attempt % 6 == 0:
            progress(f"waiting for backend indexing of {registered_name} (attempt {attempt}/360)")
        time.sleep(20)

    raise ApiError(f"Timed out waiting for backend indexing of {registered_name}", 504)


def ensure_backend_ready(backend_url):
    try:
        response = requests.get(f"{backend_url.rstrip('/')}/games/{DEFAULT_TAG}", timeout=10)
    except requests.RequestException as exc:
        raise SystemExit(
            f"Backend is not reachable at {backend_url}. Start it with:\n"
            f"  cd backend && flask --app app run --port 5000\n"
            f"Error: {exc}"
        ) from exc
    if response.status_code >= 400:
        raise SystemExit(f"Backend returned {response.status_code} for GET /games/{DEFAULT_TAG}: {response.text}")


def fetch_game(backend_url, tag):
    response = requests.get(f"{backend_url.rstrip('/')}/games/{tag}", timeout=30)
    if response.status_code >= 400:
        raise ApiError(response.text or f"failed to fetch game {tag}", response.status_code)
    return response.json()


def target_video_bitrate(duration_seconds, target_bytes):
    audio_bps = 128_000
    container_margin = 0.94
    target_bits_per_second = (target_bytes * 8 * container_margin) / duration_seconds
    video_bps = max(350_000, target_bits_per_second - audio_bps)
    return max(350, int(video_bps / 1000))


def media_duration_seconds(path):
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return max(1.0, float(completed.stdout.strip()))


def format_minutes(seconds):
    return f"{seconds / 60:.1f} min"


def load_env(path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


def load_state(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False, sort_keys=True))


def summary(state):
    return {
        "tag": state.get("tag"),
        "knowledge_store_id": state.get("knowledge_store_id"),
        "index_id": state.get("index_id"),
        "videos": {
            name: {
                "source_name": body.get("source_name"),
                "upload_name": body.get("upload_name"),
                "asset_id": body.get("asset_id"),
                "indexed_asset_id": body.get("indexed_asset_id"),
                "registered": body.get("registered", False),
            }
            for name, body in state.get("videos", {}).items()
        },
    }


def progress(message):
    print(f"[{timestamp()}] {message}", flush=True)


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


if __name__ == "__main__":
    try:
        main()
    except ApiError as exc:
        raise SystemExit(str(exc)) from exc
