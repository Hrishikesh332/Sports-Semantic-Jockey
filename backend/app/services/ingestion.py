import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.core.errors import ApiError
from app.domain.highlights import SPORTS_HIGHLIGHT_INGESTION_SCHEMA
from app.integrations.twelvelabs import request_json as twelvelabs_request_json
from app.integrations.twelvelabs import upload_asset_path
from app.services.games import public_game, register_game


ROOT_DIR = Path(__file__).resolve().parents[2]
VIDEOS_DIR = ROOT_DIR / "data" / "videos"
DEFAULT_GAME_TAG = "sports"
DEFAULT_POLL_INTERVAL_SECONDS = int(os.environ.get("SPORTS_INGEST_POLL_INTERVAL_SECONDS", "60"))
DEFAULT_POLL_ATTEMPTS = int(os.environ.get("SPORTS_INGEST_POLL_ATTEMPTS", "720"))


@dataclass(frozen=True)
class SourceVideo:
    name: str
    path: Path


@dataclass(frozen=True)
class IndexVideo:
    name: str
    path: Path
    source_name: str
    offset_seconds: float = 0


def run_ingestion(payload, progress=None):
    spec = parse_ingestion_payload(payload)
    progress = progress or (lambda message: None)
    ensure_video_links(spec["source_videos"], progress)

    state = {}
    state.setdefault("created_at", timestamp())
    state["source_videos"] = [video.name for video in spec["source_videos"]]
    state["index_videos"] = [
        {
            "name": video.name,
            "source_name": video.source_name,
            "offset_seconds": video.offset_seconds,
        }
        for video in spec["index_videos"]
    ]
    state.setdefault("asset_ids", {})
    state.setdefault("source_asset_ids", {})
    state.setdefault("item_ids", {})
    state.setdefault("item_statuses", {})
    state.setdefault("multipart_uploads", {})

    store_id = spec["knowledge_store_id"]
    if not store_id:
        store = create_knowledge_store(spec)
        store_id = store["_id"]
        state["knowledge_store_id"] = store_id
        state["knowledge_store"] = store
        progress(f"created knowledge store {store_id}")
    else:
        state["knowledge_store_id"] = store_id
        progress(f"using existing knowledge store {store_id}")

    upload_source_assets(spec["source_videos"], state, progress)
    upload_index_assets(spec["index_videos"], state, progress)
    add_index_items(store_id, spec["index_videos"], state, progress)
    poll_items_until_ready(
        store_id=store_id,
        state=state,
        poll_attempts=spec["poll_attempts"],
        poll_interval_seconds=spec["poll_interval_seconds"],
        progress=progress,
    )

    video_reference_map = build_video_reference_map(state, spec["index_videos"])
    source_asset_ids = source_asset_ids_for_game(spec["source_videos"], state)
    game_payload = {
        "tag": spec["tag"],
        "label": spec["label"],
        "sport": spec["sport"],
        "knowledge_store_id": store_id,
        "source_videos": [video.name for video in spec["source_videos"]],
        "video_asset_ids": source_asset_ids,
        "video_reference_map": video_reference_map,
    }
    game = register_game(game_payload)
    state["registered_game"] = game
    progress(f"registered {spec['tag']} game")

    if not all(status == "ready" for status in state["item_statuses"].values()):
        return build_ingestion_response(spec, state, game, "indexing")

    if spec["generate_highlights"]:
        progress("skipped ingestion-time highlight logs; use /games/<tag>/highlight-reels for live Pegasus output")

    return build_ingestion_response(spec, state, game, "ready")


def parse_ingestion_payload(payload):
    if not isinstance(payload, dict):
        raise ApiError("JSON object body is required", 400)

    tag = required_string(payload, "tag", DEFAULT_GAME_TAG)
    label = required_string(payload, "label", tag.title())
    sport = required_string(payload, "sport", label)
    source_videos = parse_source_videos(payload.get("source_videos"))
    index_videos = parse_index_videos(payload.get("index_videos"), source_videos)
    return {
        "tag": tag,
        "label": label,
        "sport": sport,
        "source_videos": source_videos,
        "index_videos": index_videos,
        "knowledge_store_id": optional_string(payload.get("knowledge_store_id")),
        "knowledge_store_name": optional_string(payload.get("knowledge_store_name"))
        or f"{label} Knowledge Base {timestamp()}",
        "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
        "generate_highlights": bool(payload.get("generate_highlights", False)),
        "poll_attempts": optional_positive_int(payload.get("poll_attempts"), DEFAULT_POLL_ATTEMPTS),
        "poll_interval_seconds": optional_positive_int(
            payload.get("poll_interval_seconds"),
            DEFAULT_POLL_INTERVAL_SECONDS,
            allow_zero=True,
        ),
    }


def parse_source_videos(value):
    if not isinstance(value, list) or not value:
        raise ApiError("source_videos must be a non-empty array", 400)

    videos = []
    names = set()
    for item in value:
        if isinstance(item, str):
            path = resolve_video_path(item)
            name = path.name
        elif isinstance(item, dict):
            path = resolve_video_path(required_string(item, "path"))
            name = optional_string(item.get("name")) or path.name
        else:
            raise ApiError("source_videos entries must be strings or objects", 400)
        if name in names:
            raise ApiError(f"duplicate source video name: {name}", 400)
        names.add(name)
        videos.append(SourceVideo(name=name, path=path))
    return videos


def parse_index_videos(value, source_videos):
    source_names = {video.name for video in source_videos}
    if value is None:
        return [
            IndexVideo(name=video.name, path=video.path, source_name=video.name, offset_seconds=0)
            for video in source_videos
        ]
    if not isinstance(value, list) or not value:
        raise ApiError("index_videos must be a non-empty array when provided", 400)

    videos = []
    names = set()
    for item in value:
        if isinstance(item, str):
            path = resolve_video_path(item)
            source_name = path.name
            offset_seconds = 0
        elif isinstance(item, dict):
            path = resolve_video_path(required_string(item, "path"))
            source_name = required_string(item, "source_name")
            offset_seconds = number_value(item.get("offset_seconds", 0), "offset_seconds")
        else:
            raise ApiError("index_videos entries must be strings or objects", 400)
        if source_name not in source_names:
            raise ApiError(f"index video source_name is not a source video: {source_name}", 400)
        if path.name in names:
            raise ApiError(f"duplicate index video name: {path.name}", 400)
        names.add(path.name)
        videos.append(IndexVideo(name=path.name, path=path, source_name=source_name, offset_seconds=offset_seconds))
    return videos


def resolve_video_path(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError("video path must be a non-empty string", 400)
    path = Path(value.strip()).expanduser()
    if not path.is_absolute():
        path = ROOT_DIR / path
    path = path.resolve()
    if not path.exists() or not path.is_file():
        raise ApiError(f"video file not found: {path}", 400)
    return path


def ensure_video_links(source_videos, progress):
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    for video in source_videos:
        link_path = VIDEOS_DIR / video.name
        if link_path.exists() or link_path.is_symlink():
            continue
        link_path.symlink_to(os.path.relpath(video.path, link_path.parent))
        progress(f"linked local media for {video.name}")


def create_knowledge_store(spec):
    metadata = {"game_tag": spec["tag"], "source": "sports-jockey"}
    metadata.update({str(key): str(value) for key, value in spec["metadata"].items()})
    return twelvelabs_request_json(
        "post",
        "/knowledge-stores",
        {
            "name": spec["knowledge_store_name"],
            "ingestion_config": {
                "enrichment_config": {
                    "type": "json_schema",
                    "json_schema": SPORTS_HIGHLIGHT_INGESTION_SCHEMA,
                }
            },
            "metadata": metadata,
        },
    )


def upload_source_assets(source_videos, state, progress):
    for video in source_videos:
        if state["source_asset_ids"].get(video.name):
            progress(f"source asset already uploaded for {video.name}: {state['source_asset_ids'][video.name]}")
            continue
        if state["asset_ids"].get(video.name):
            state["source_asset_ids"][video.name] = state["asset_ids"][video.name]
            progress(f"using existing asset for source {video.name}: {state['source_asset_ids'][video.name]}")
            continue
        asset = upload_video_asset(video.name, video.path, state, progress)
        state["source_asset_ids"][video.name] = asset["_id"]
        state["asset_ids"][video.name] = asset["_id"]
        state.setdefault("assets", {})[video.name] = asset
        progress(f"uploaded source asset {asset['_id']} for {video.name}")


def upload_index_assets(index_videos, state, progress):
    for video in index_videos:
        if state["asset_ids"].get(video.name):
            progress(f"index asset already uploaded for {video.name}: {state['asset_ids'][video.name]}")
            continue
        if video.name == video.source_name and state["source_asset_ids"].get(video.source_name):
            state["asset_ids"][video.name] = state["source_asset_ids"][video.source_name]
            progress(f"using source asset for index video {video.name}: {state['asset_ids'][video.name]}")
            continue
        asset = upload_video_asset(video.name, video.path, state, progress)
        state["asset_ids"][video.name] = asset["_id"]
        state.setdefault("assets", {})[video.name] = asset
        progress(f"uploaded index asset {asset['_id']} for {video.name}")


def upload_video_asset(video_name, path, state, progress):
    multipart_state = state.setdefault("multipart_uploads", {}).setdefault(video_name, {})

    progress(f"uploading {video_name} ({path.stat().st_size / (1024 ** 3):.2f} GB)")
    return upload_asset_path(
        path,
        multipart_state=multipart_state,
        progress=progress,
    )


def add_index_items(store_id, index_videos, state, progress):
    for video in index_videos:
        if state["item_ids"].get(video.name):
            progress(f"item already added for {video.name}: {state['item_ids'][video.name]}")
            continue
        item = twelvelabs_request_json(
            "post",
            f"/knowledge-stores/{store_id}/items",
            {"asset_id": state["asset_ids"][video.name]},
        )
        state["item_ids"][video.name] = item["_id"]
        state.setdefault("items", {})[video.name] = item
        state["item_statuses"][video.name] = item.get("status", "unknown")
        progress(f"added item {item['_id']} for {video.name}")


def poll_items_until_ready(store_id, state, poll_attempts, poll_interval_seconds, progress):
    for attempt in range(1, poll_attempts + 1):
        pending = []
        for video_name, item_id in state["item_ids"].items():
            current_status = state["item_statuses"].get(video_name)
            if current_status == "ready":
                continue
            item = twelvelabs_request_json("get", f"/knowledge-stores/{store_id}/items/{item_id}")
            status = item.get("status", "unknown")
            state["item_statuses"][video_name] = status
            state.setdefault("item_status_bodies", {})[video_name] = item
            if status not in {"ready", "failed"}:
                pending.append(video_name)
            progress(f"item {item_id} for {video_name}: {status}")
        if any(status == "failed" for status in state["item_statuses"].values()):
            raise ApiError("one or more knowledge store items failed indexing", 502)
        if not pending:
            return
        progress(f"waiting {poll_interval_seconds}s for indexing, attempt {attempt}/{poll_attempts}")
        if poll_interval_seconds:
            time.sleep(poll_interval_seconds)


def build_video_reference_map(state, index_videos):
    mapping = {}
    specs = {video.name: video for video in index_videos}
    for video_name, item_id in state["item_ids"].items():
        source_name = specs.get(video_name, IndexVideo(video_name, Path(video_name), video_name)).source_name
        mapping[video_name] = source_name
        asset_id = state.get("asset_ids", {}).get(video_name)
        if asset_id:
            mapping[asset_id] = source_name
        mapping[item_id] = source_name
        if item_id.startswith("ksi_"):
            mapping[item_id.removeprefix("ksi_")] = source_name
    return mapping


def source_asset_ids_for_game(source_videos, state):
    asset_ids = {}
    for video in source_videos:
        asset_id = state.get("source_asset_ids", {}).get(video.name) or state.get("asset_ids", {}).get(video.name)
        if not asset_id:
            raise ApiError(f"source asset id missing for video: {video.name}", 500)
        asset_ids[video.name] = asset_id
    return asset_ids


def build_ingestion_response(spec, state, game, status):
    return {
        "status": status,
        "knowledge_store_id": state.get("knowledge_store_id"),
        "source_videos": [video.name for video in spec["source_videos"]],
        "index_videos": [
            {
                "name": video.name,
                "source_name": video.source_name,
                "offset_seconds": video.offset_seconds,
            }
            for video in spec["index_videos"]
        ],
        "video_asset_ids": source_asset_ids_for_game(spec["source_videos"], state),
        "item_statuses": state.get("item_statuses", {}),
        "game": public_game(game),
    }


def required_string(payload, key, default=None):
    value = payload.get(key, default) if isinstance(payload, dict) else default
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{key} is required", 400)
    return value.strip()


def optional_string(value):
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ApiError("value must be a non-empty string", 400)
    return value.strip()


def optional_positive_int(value, default, allow_zero=False):
    if value is None:
        return default
    if not isinstance(value, int):
        raise ApiError("poll options must be integers", 400)
    if value < 0 or (value == 0 and not allow_zero):
        raise ApiError("poll options must be positive integers", 400)
    return value


def number_value(value, field_name):
    if not isinstance(value, (int, float)):
        raise ApiError(f"{field_name} must be a number", 400)
    return float(value)


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
