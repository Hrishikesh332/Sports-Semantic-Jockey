import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FOLDER = ROOT / "videosss"
DEFAULT_PREPARED_FOLDER = ROOT / "data" / "videosss_prepared"
DEFAULT_STATE_PATH = ROOT / "data" / "videosss_ingest_state.json"
DEFAULT_TAG = "sports"
DEFAULT_MAX_UPLOAD_BYTES = 1_950_000_000
DEFAULT_TARGET_UPLOAD_BYTES = 1_850_000_000

sys.path.insert(0, str(ROOT))

from app.core.errors import ApiError
from app.integrations.twelvelabs import request_json as twelvelabs_request_json
from app.integrations.twelvelabs import upload_asset_path
from app.services.games import (
    VIDEOS_DIR,
    add_game_video_to_knowledge_store,
    add_game_video_to_search_index,
    configured_search_index_id,
    get_game,
    indexed_asset_asset_id,
    list_indexed_assets,
    register_game,
    response_id,
    wait_for_uploaded_asset_ready,
)


def main():
    args = parse_args()
    load_env(ROOT / ".env")
    state = load_state(args.state_path)
    folder = args.folder.resolve()
    videos = sorted(folder.glob("*.mp4"))
    if not videos:
        raise SystemExit(f"No MP4 files found in {folder}")

    game = get_game(args.tag)
    knowledge_store_id = game["knowledge_store_id"]
    index_id = configured_search_index_id(game)
    state.setdefault("tag", args.tag)
    state.setdefault("knowledge_store_id", knowledge_store_id)
    state.setdefault("index_id", index_id)
    state.setdefault("videos", {})
    save_state(args.state_path, state)

    progress(f"using game {args.tag}, knowledge store {knowledge_store_id}, index {index_id}")
    progress(f"found {len(videos)} mp4 files in {folder}")

    for path in videos:
        ingest_video(
            tag=args.tag,
            path=path,
            knowledge_store_id=knowledge_store_id,
            index_id=index_id,
            state=state,
            state_path=args.state_path,
            prepared_folder=args.prepared_folder,
            max_upload_bytes=args.max_upload_bytes,
            target_upload_bytes=args.target_upload_bytes,
            poll_item=args.poll_items,
        )

    progress("finished videosss upload + knowledge-store + index registration")
    print(json.dumps(summary(state), indent=2, ensure_ascii=False))


def parse_args():
    parser = argparse.ArgumentParser(description="Upload backend/videosss MP4s into the Sports workspace.")
    parser.add_argument("--folder", type=Path, default=DEFAULT_FOLDER)
    parser.add_argument("--prepared-folder", type=Path, default=DEFAULT_PREPARED_FOLDER)
    parser.add_argument("--state-path", type=Path, default=DEFAULT_STATE_PATH)
    parser.add_argument("--tag", default=DEFAULT_TAG)
    parser.add_argument("--max-upload-bytes", type=int, default=DEFAULT_MAX_UPLOAD_BYTES)
    parser.add_argument("--target-upload-bytes", type=int, default=DEFAULT_TARGET_UPLOAD_BYTES)
    parser.add_argument("--poll-items", action="store_true", help="Poll knowledge-store items until ready.")
    return parser.parse_args()


def ingest_video(
    tag,
    path,
    knowledge_store_id,
    index_id,
    state,
    state_path,
    prepared_folder,
    max_upload_bytes,
    target_upload_bytes,
    poll_item=False,
):
    video_name = path.name
    video_state = state["videos"].setdefault(video_name, {"path": str(path)})
    video_state["path"] = str(path)
    ensure_local_video_link(path)
    upload_path = prepare_upload_source(
        path=path,
        video_state=video_state,
        state=state,
        state_path=state_path,
        prepared_folder=prepared_folder,
        max_upload_bytes=max_upload_bytes,
        target_upload_bytes=target_upload_bytes,
    )
    reset_upload_state_if_source_changed(video_state, upload_path, state, state_path)
    video_state["upload_path"] = str(upload_path)
    save_state(state_path, state)

    asset_id = video_state.get("asset_id")
    if asset_id:
        progress(f"asset already uploaded for {video_name}: {asset_id}")
    else:
        multipart_state = video_state.setdefault("multipart_upload", {})
        progress(f"uploading asset for {video_name} ({upload_path.stat().st_size / (1024 ** 3):.2f} GB)")
        asset = upload_asset_with_recovery(upload_path, video_name, multipart_state, state, state_path)
        asset_id = response_id(asset)
        if not asset_id:
            raise ApiError(f"TwelveLabs upload response did not include asset id for {video_name}", 502)
        video_state["asset_id"] = asset_id
        video_state["asset"] = asset
        save_state(state_path, state)
        progress(f"uploaded asset {asset_id} for {video_name}")

    wait_for_asset(asset_id, video_state, state, state_path)

    item_id = video_state.get("knowledge_store_item_id")
    if item_id:
        progress(f"knowledge-store item already exists for {video_name}: {item_id}")
    else:
        item = add_game_video_to_knowledge_store(knowledge_store_id, asset_id)
        item_id = response_id(item)
        if not item_id:
            raise ApiError(f"Knowledge-store item response missing id for {video_name}", 502)
        video_state["knowledge_store_item_id"] = item_id
        video_state["knowledge_store_item"] = item
        video_state["knowledge_store_item_status"] = item.get("status", "unknown")
        save_state(state_path, state)
        progress(f"added knowledge-store item {item_id} for {video_name}")

    if poll_item:
        poll_knowledge_store_item(knowledge_store_id, item_id, video_state, state, state_path, video_name)

    indexed_asset_id = video_state.get("indexed_asset_id") or indexed_asset_id_for_asset(index_id, asset_id)
    if indexed_asset_id:
        video_state["indexed_asset_id"] = indexed_asset_id
        progress(f"indexed asset already exists for {video_name}: {indexed_asset_id}")
    else:
        indexed_asset = add_game_video_to_search_index(index_id, asset_id)
        indexed_asset_id = response_id(indexed_asset)
        if not indexed_asset_id:
            raise ApiError(f"Index response missing indexed asset id for {video_name}", 502)
        video_state["indexed_asset_id"] = indexed_asset_id
        video_state["indexed_asset"] = indexed_asset
        save_state(state_path, state)
        progress(f"added index asset {indexed_asset_id} for {video_name}")

    merge_game_registration(tag, video_name, asset_id, indexed_asset_id, item_id)
    video_state["registered"] = True
    save_state(state_path, state)
    progress(f"registered {video_name} in workspace")


def prepare_upload_source(
    path,
    video_state,
    state,
    state_path,
    prepared_folder,
    max_upload_bytes,
    target_upload_bytes,
):
    size = path.stat().st_size
    if size <= max_upload_bytes:
        video_state["upload_source_kind"] = "original"
        return path

    prepared_folder.mkdir(parents=True, exist_ok=True)
    output_path = prepared_folder / path.name
    if output_path.exists() and output_path.stat().st_size <= max_upload_bytes:
        video_state["upload_source_kind"] = "proxy"
        video_state["prepared_path"] = str(output_path)
        video_state["prepared_size_bytes"] = output_path.stat().st_size
        return output_path

    progress(
        f"preparing upload-safe proxy for {path.name} "
        f"({size / (1000 ** 3):.2f} GB > {max_upload_bytes / (1000 ** 3):.2f} GB)"
    )
    duration = media_duration_seconds(path)
    video_bitrate = target_video_bitrate(duration, target_upload_bytes)
    temporary_path = output_path.with_suffix(output_path.suffix + ".tmp.mp4")
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(path),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "scale=min(1280\\,iw):-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        f"{video_bitrate}k",
        "-maxrate",
        f"{max(video_bitrate, int(video_bitrate * 1.35))}k",
        "-bufsize",
        f"{max(video_bitrate * 2, 600)}k",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        str(temporary_path),
    ]
    subprocess.run(command, check=True)
    temporary_path.replace(output_path)
    if output_path.stat().st_size > max_upload_bytes:
        raise ApiError(
            {
                "message": "prepared proxy is still above TwelveLabs processing limit",
                "video": path.name,
                "prepared_size_bytes": output_path.stat().st_size,
                "max_upload_bytes": max_upload_bytes,
            },
            413,
        )
    video_state["upload_source_kind"] = "proxy"
    video_state["prepared_path"] = str(output_path)
    video_state["prepared_size_bytes"] = output_path.stat().st_size
    save_state(state_path, state)
    progress(f"prepared proxy for {path.name}: {output_path.stat().st_size / (1000 ** 3):.2f} GB")
    return output_path


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


def target_video_bitrate(duration_seconds, target_bytes):
    audio_bps = 96_000
    container_margin = 0.94
    target_bits_per_second = (target_bytes * 8 * container_margin) / duration_seconds
    video_bps = max(350_000, target_bits_per_second - audio_bps)
    return max(350, int(video_bps / 1000))


def reset_upload_state_if_source_changed(video_state, upload_path, state, state_path):
    recorded_path = video_state.get("upload_path")
    if not recorded_path:
        if Path(video_state["path"]) == upload_path or not video_state.get("asset_id"):
            return
    elif Path(recorded_path) == upload_path:
        return
    for key in (
        "asset",
        "asset_id",
        "asset_ready",
        "asset_status",
        "indexed_asset",
        "indexed_asset_id",
        "knowledge_store_item",
        "knowledge_store_item_id",
        "knowledge_store_item_status",
        "knowledge_store_item_last_body",
        "multipart_upload",
        "registered",
    ):
        video_state.pop(key, None)
    save_state(state_path, state)
    progress(f"upload source changed for {Path(video_state['path']).name}; cleared stale upload state")


def upload_asset_with_recovery(path, video_name, multipart_state, state, state_path):
    for attempt in range(1, 3):
        try:
            return upload_asset_path(
                path,
                multipart_state=multipart_state,
                on_state_change=lambda: save_state(state_path, state),
                progress=progress,
            )
        except ApiError as exc:
            if attempt == 1 and is_expired_multipart_upload(exc):
                multipart_state.clear()
                save_state(state_path, state)
                progress(f"expired multipart session for {video_name}; starting a fresh upload session")
                continue
            raise
    raise ApiError(f"Unable to upload {video_name}", 502)


def is_expired_multipart_upload(error):
    message = error.message
    text = json.dumps(message).lower() if isinstance(message, dict) else str(message).lower()
    return "upload session is expired" in text or "upload_id parameter is invalid" in text


def wait_for_asset(asset_id, video_state, state, state_path):
    if video_state.get("asset_ready"):
        return
    asset = video_state.get("asset") if isinstance(video_state.get("asset"), dict) else {"_id": asset_id}
    ready_asset = wait_for_uploaded_asset_ready(asset_id, asset)
    video_state["asset_ready"] = True
    video_state["asset_status"] = ready_asset.get("status", "ready")
    save_state(state_path, state)


def poll_knowledge_store_item(knowledge_store_id, item_id, video_state, state, state_path, video_name):
    for attempt in range(1, 181):
        item = twelvelabs_request_json("get", f"/knowledge-stores/{knowledge_store_id}/items/{item_id}")
        status = item.get("status", "unknown")
        video_state["knowledge_store_item_status"] = status
        video_state["knowledge_store_item_last_body"] = item
        save_state(state_path, state)
        progress(f"knowledge-store item {item_id} for {video_name}: {status}")
        if status == "ready":
            return
        if status == "failed":
            raise ApiError(f"Knowledge-store item failed for {video_name}", 502)
        time.sleep(20)


def indexed_asset_id_for_asset(index_id, asset_id):
    for indexed_asset in list_indexed_assets(index_id):
        if indexed_asset_asset_id(indexed_asset) == asset_id:
            return response_id(indexed_asset)
    return None


def merge_game_registration(tag, video_name, asset_id, indexed_asset_id, item_id):
    game = get_game(tag)
    source_videos = unique_preserving_order([*game.get("source_videos", []), video_name])
    video_asset_ids = dict(game.get("video_asset_ids", {}))
    marengo_video_ids = dict(game.get("marengo_video_ids", {}))
    video_reference_map = dict(game.get("video_reference_map", {}))

    video_asset_ids[video_name] = asset_id
    if indexed_asset_id:
        marengo_video_ids[video_name] = indexed_asset_id
    for reference in (video_name, asset_id, indexed_asset_id, item_id):
        if reference:
            video_reference_map[reference] = video_name
    if item_id and item_id.startswith("ksi_"):
        video_reference_map[item_id.removeprefix("ksi_")] = video_name

    payload = {
        "tag": game["tag"],
        "label": game["label"],
        "sport": game["sport"],
        "knowledge_store_id": game["knowledge_store_id"],
        "source_videos": source_videos,
        "video_asset_ids": video_asset_ids,
        "marengo_video_ids": marengo_video_ids,
        "video_reference_map": video_reference_map,
        "marengo_index_id": game.get("marengo_index_id"),
    }
    if "wsc_baseline" in game:
        payload["wsc_baseline"] = game["wsc_baseline"]
    register_game(payload)


def ensure_local_video_link(path):
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    link_path = VIDEOS_DIR / path.name
    if link_path.exists() or link_path.is_symlink():
        return
    link_path.symlink_to(os.path.relpath(path, link_path.parent))
    progress(f"linked local media for {path.name}")


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
                "asset_id": body.get("asset_id"),
                "knowledge_store_item_id": body.get("knowledge_store_item_id"),
                "knowledge_store_item_status": body.get("knowledge_store_item_status"),
                "indexed_asset_id": body.get("indexed_asset_id"),
                "registered": body.get("registered", False),
            }
            for name, body in state.get("videos", {}).items()
        },
    }


def unique_preserving_order(values):
    seen = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def progress(message):
    print(f"[{timestamp()}] {message}", flush=True)


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


if __name__ == "__main__":
    try:
        main()
    except ApiError as exc:
        raise SystemExit(str(exc)) from exc
