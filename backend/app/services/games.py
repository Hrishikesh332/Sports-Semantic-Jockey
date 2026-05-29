import json
import logging
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from copy import deepcopy
from pathlib import Path
from threading import Lock

from app.core.config import TWELVELABS_MODEL, TWELVELABS_PEGASUS_MODEL, default_game_registrations, twelvelabs_index_id
from app.core.errors import ApiError
from app.integrations.twelvelabs import request_form as twelvelabs_request_form
from app.integrations.twelvelabs import request_json as twelvelabs_request_json
from app.integrations.twelvelabs import upload_asset_path
from app.services.highlights import generate_pegasus_highlight_reels


ROOT_DIR = Path(__file__).resolve().parents[2]
GAMES_DIR = ROOT_DIR / "data" / "games"
VIDEOS_DIR = ROOT_DIR / "data" / "videos"
THUMBNAILS_DIR = ROOT_DIR / "data" / "thumbnails"
REELS_DIR = ROOT_DIR / "data" / "reels"
REEL_THUMBNAILS_DIR = REELS_DIR / "thumbnails"
LOGGER = logging.getLogger(__name__)
TAG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
REEL_FORMATS = {
    "9x16": {"label": "9:16", "width": 1080, "height": 1920},
    "16x9": {"label": "16:9", "width": 1920, "height": 1080},
    "1x1": {"label": "1:1", "width": 1080, "height": 1080},
    "4x5": {"label": "4:5", "width": 1080, "height": 1350},
}
HIGHLIGHT_RESPONSE_KEYS = {
    "match_summary",
    "standard_stats",
    "best_plays",
    "emotional_moments",
    "fan_experience",
    "behind_the_scenes",
}
HIGHLIGHT_CATEGORY_KEYS = [
    "standard_stats",
    "best_plays",
    "emotional_moments",
    "fan_experience",
    "behind_the_scenes",
]
MARENGO_SEARCH_FILTER_QUERIES = {
    "semantic": "emotional visual reaction crowd atmosphere celebration contextual meaning",
    "standard_stats": "scoring play game action official event scoreboard moment",
    "best_plays": "decisive play goal save scoring chance momentum swing highlight",
    "emotional_moments": "player emotion celebration frustration relief heartbreak fist pump tears",
    "fan_experience": "crowd roar fans cheering stadium atmosphere visible fan reaction",
    "behind_the_scenes": "warmup bench coach sideline huddle tunnel behind the scenes",
}
MARENGO_SEARCH_OPTIONS = {"visual", "audio", "transcription"}
MARENGO_SEARCH_GROUP_BY = {"clip"}
UPLOAD_ASSET_READY_POLL_ATTEMPTS = int(os.environ.get("SPORTS_UPLOAD_ASSET_POLL_ATTEMPTS", "30"))
UPLOAD_ASSET_READY_POLL_INTERVAL_SECONDS = int(os.environ.get("SPORTS_UPLOAD_ASSET_POLL_INTERVAL_SECONDS", "5"))
UPLOAD_BACKGROUND_EXECUTOR = ThreadPoolExecutor(max_workers=int(os.environ.get("SPORTS_UPLOAD_BACKGROUND_WORKERS", "4")))
UPLOAD_METADATA_LOCK = Lock()
PEGASUS_SYNC_WINDOW_SECONDS = int(os.environ.get("PEGASUS_SYNC_WINDOW_SECONDS", "3300"))
STREAM_INFO_CACHE_TTL_SECONDS = int(os.environ.get("SPORTS_STREAM_INFO_CACHE_TTL_SECONDS", "900"))
STREAM_INFO_CACHE = {}
STREAM_INFO_CACHE_LOCK = Lock()
PEGASUS_METADATA_CACHE_SCHEMA_VERSION = 2
PEGASUS_METADATA_VERIFY_ATTEMPTS = int(os.environ.get("PEGASUS_METADATA_VERIFY_ATTEMPTS", "3"))
PEGASUS_METADATA_VERIFY_INTERVAL_SECONDS = float(os.environ.get("PEGASUS_METADATA_VERIFY_INTERVAL_SECONDS", "1"))
PEGASUS_REELS_METADATA_FIELD = "sports_jockey_pegasus_reels_v2"
PEGASUS_DETAILED_RESPONSE_METADATA_FIELD = "sports_jockey_pegasus_detailed_response_v2"
PEGASUS_REELS_HASH_METADATA_FIELD = "sports_jockey_pegasus_reels_hash_v2"
PEGASUS_REELS_MODEL_METADATA_FIELD = "sports_jockey_pegasus_model_v2"
PEGASUS_REELS_ASSET_ID_METADATA_FIELD = "sports_jockey_pegasus_asset_id_v2"
PEGASUS_REELS_INDEXED_ASSET_ID_METADATA_FIELD = "sports_jockey_pegasus_indexed_asset_id_v2"
PEGASUS_REELS_INDEX_ID_METADATA_FIELD = "sports_jockey_pegasus_index_id_v2"
PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD = "sports_jockey_pegasus_source_video_v2"
PEGASUS_REELS_GENERATED_AT_METADATA_FIELD = "sports_jockey_pegasus_generated_at_v2"
PEGASUS_RESPONSE_METADATA_FIELD = "_pegasus_metadata"
JOCKEY_CHAT_SCHEMA = {
    "type": "object",
    "properties": {
        "narrative_summary": {"type": "string"},
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "video_reference": {"type": "string"},
                    "start_time": {"type": "string"},
                    "end_time": {"type": "string"},
                    "moment_type": {"type": "string"},
                    "emotional_intensity": {"type": "string"},
                    "jockey_rationale": {"type": "string"},
                    "highlight_potential": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": [
                    "video_reference",
                    "start_time",
                    "end_time",
                    "moment_type",
                    "emotional_intensity",
                    "jockey_rationale",
                    "highlight_potential",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["narrative_summary", "clips"],
    "additionalProperties": False,
}
GAME_DEBUG_FIELDS = {
    "jockey_metadata_cache",
    "marengo_index_id",
}


def list_games():
    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    games_by_tag = {
        game["tag"]: deepcopy(game)
        for game in default_game_registrations()
        if isinstance(game.get("tag"), str) and game["tag"]
    }
    for path in sorted(GAMES_DIR.glob("*.json")):
        game = read_json(path)
        games_by_tag[game["tag"]] = game
    games = [public_game(game) for game in games_by_tag.values()]
    return {"games": games}


def list_game_index_videos(tag):
    game = get_game(tag)
    index_id = configured_search_index_id(game)
    videos = [
        normalize_index_video(index_id, indexed_asset_with_user_metadata(index_id, indexed_asset))
        for indexed_asset in list_indexed_assets(index_id)
    ]
    return {
        "index_id": index_id,
        "index_videos": [video for video in videos if video.get("id")],
    }


def get_game(tag):
    path = game_path(tag)
    if path.exists():
        return read_json(path)
    for game in default_game_registrations():
        if game.get("tag") == tag:
            return deepcopy(game)
    raise ApiError("game not found", 404)


def public_game(game):
    return {key: value for key, value in game.items() if key not in GAME_DEBUG_FIELDS}


def register_game(payload):
    tag = required_payload_string(payload, "tag")
    if not TAG_PATTERN.match(tag):
        raise ApiError("tag must be lowercase letters, numbers, and hyphens", 400)

    path = game_path(tag)
    existing_game = read_json(path) if path.exists() else {}
    source_videos = validate_source_videos(payload.get("source_videos", []))
    game = {
        "tag": tag,
        "label": required_payload_string(payload, "label"),
        "sport": required_payload_string(payload, "sport"),
        "knowledge_store_id": required_payload_string(payload, "knowledge_store_id"),
        "source_videos": source_videos,
    }

    video_reference_map = validate_video_reference_map(payload.get("video_reference_map", {}), source_videos)
    if video_reference_map:
        game["video_reference_map"] = video_reference_map

    video_asset_ids = validate_video_asset_ids(payload.get("video_asset_ids", {}), source_videos)
    if video_asset_ids:
        game["video_asset_ids"] = video_asset_ids

    marengo_index_id = clean_optional_string(payload.get("marengo_index_id")) or clean_optional_string(existing_game.get("marengo_index_id"))
    if marengo_index_id:
        game["marengo_index_id"] = marengo_index_id
    marengo_video_ids = validate_video_asset_ids(payload.get("marengo_video_ids", existing_game.get("marengo_video_ids", {})), source_videos)
    if marengo_video_ids:
        game["marengo_video_ids"] = marengo_video_ids

    if "wsc_baseline" in payload:
        game["wsc_baseline"] = payload["wsc_baseline"]
    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(game, indent=2, ensure_ascii=False))
    return game


def upload_game_video(tag, uploaded_file):
    game = get_game(tag)
    search_index_id, created_index = ensure_game_search_index(game)
    video_name = unique_uploaded_video_name(safe_uploaded_video_name(uploaded_file.filename))
    local_path = save_uploaded_game_video(uploaded_file, video_name)

    uploaded_asset = upload_asset_path(local_path)
    asset_id = response_id(uploaded_asset)
    if not asset_id:
        raise ApiError("TwelveLabs upload response did not include an asset id", 502)

    updated_game = update_uploaded_game_metadata(
        tag=tag,
        video_name=video_name,
        asset_id=asset_id,
        search_index_id=search_index_id,
    )
    queue_uploaded_video_indexing(
        tag=tag,
        video_name=video_name,
        asset_id=asset_id,
        uploaded_asset=uploaded_asset,
        search_index_id=search_index_id,
    )
    return {
        "status": "indexing",
        "video_name": video_name,
        "asset_id": asset_id,
        "asset": uploaded_asset,
        "knowledge_store_id": game["knowledge_store_id"],
        "index_configured": True,
        "created_search_index": bool(created_index),
        "message": "Upload accepted. The index and knowledge-base item will be ready in a few minutes.",
        "game": public_game(updated_game),
    }


def queue_uploaded_video_indexing(tag, video_name, asset_id, uploaded_asset, search_index_id):
    UPLOAD_BACKGROUND_EXECUTOR.submit(
        finish_uploaded_video_indexing,
        tag,
        video_name,
        asset_id,
        uploaded_asset,
        search_index_id,
    )


def finish_uploaded_video_indexing(tag, video_name, asset_id, uploaded_asset, search_index_id):
    try:
        wait_for_uploaded_asset_ready(asset_id, uploaded_asset)
        game = get_game(tag)
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {
                "knowledge_store_item": executor.submit(add_game_video_to_knowledge_store, game["knowledge_store_id"], asset_id),
                "indexed_asset": executor.submit(add_game_video_to_search_index, search_index_id, asset_id),
            }
            knowledge_store_item = futures["knowledge_store_item"].result()
            indexed_asset = futures["indexed_asset"].result()

        update_uploaded_game_metadata(
            tag=tag,
            video_name=video_name,
            asset_id=asset_id,
            search_index_id=search_index_id,
            knowledge_store_item=knowledge_store_item,
            indexed_asset=indexed_asset,
        )
    except Exception:
        LOGGER.exception("Failed to finish upload indexing for %s (%s)", video_name, asset_id)


def update_uploaded_game_metadata(
    tag,
    video_name,
    asset_id,
    search_index_id,
    knowledge_store_item=None,
    indexed_asset=None,
):
    with UPLOAD_METADATA_LOCK:
        game = get_game(tag)
        return register_game(
            uploaded_game_payload(
                game=game,
                video_name=video_name,
                asset_id=asset_id,
                search_index_id=search_index_id,
                knowledge_store_item=knowledge_store_item,
                indexed_asset=indexed_asset,
            )
        )


def safe_uploaded_video_name(filename):
    raw_name = Path(filename or "").name.strip().replace("\x00", "")
    if not raw_name:
        raise ApiError("file is required", 400)

    path = Path(raw_name)
    stem = re.sub(r"[^a-zA-Z0-9._() -]+", "-", path.stem).strip(" .-")
    suffix = re.sub(r"[^a-zA-Z0-9.]+", "", path.suffix).strip(".")
    if not stem:
        stem = "uploaded-video"
    if not suffix:
        suffix = "mp4"
    return f"{stem[:120]}.{suffix[:16].lower()}"


def unique_uploaded_video_name(video_name):
    candidate = video_name
    if not video_path(candidate).exists():
        return candidate

    stem = Path(video_name).stem
    suffix = Path(video_name).suffix or ".mp4"
    for index in range(2, 1000):
        candidate = f"{stem}-{index}{suffix}"
        if not video_path(candidate).exists():
            return candidate
    raise ApiError("could not create a unique video filename", 409)


def save_uploaded_game_video(uploaded_file, video_name):
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    destination = video_path(video_name)
    uploaded_file.save(destination)
    if not destination.exists() or destination.stat().st_size <= 0:
        raise ApiError("uploaded file is empty", 400)
    return destination


def wait_for_uploaded_asset_ready(asset_id, uploaded_asset):
    current_asset = uploaded_asset if isinstance(uploaded_asset, dict) else {}
    if clean_optional_string(current_asset.get("status")) == "ready":
        return current_asset

    for attempt in range(1, max(1, UPLOAD_ASSET_READY_POLL_ATTEMPTS) + 1):
        if attempt > 1 and UPLOAD_ASSET_READY_POLL_INTERVAL_SECONDS:
            time.sleep(UPLOAD_ASSET_READY_POLL_INTERVAL_SECONDS)
        current_asset = twelvelabs_request_json("get", f"/assets/{asset_id}")
        status = clean_optional_string(current_asset.get("status"))
        if status == "ready":
            return current_asset
        if status in {"failed", "error"}:
            raise ApiError({"message": "uploaded asset failed processing", "asset_id": asset_id, "status": status}, 502)

    raise ApiError(
        {
            "message": "uploaded asset is not ready yet",
            "asset_id": asset_id,
            "status": current_asset.get("status", "unknown"),
        },
        409,
    )


def ensure_game_search_index(game):
    return configured_search_index_id(game), None


def configured_search_index_id(game=None):
    index_id = clean_optional_string(game.get("marengo_index_id")) if isinstance(game, dict) else None
    index_id = index_id or clean_optional_string(twelvelabs_index_id())
    if not index_id:
        raise ApiError("INDEX_ID or game marengo_index_id is required for search and indexing", 500)
    return index_id


def add_game_video_to_knowledge_store(knowledge_store_id, asset_id):
    return twelvelabs_request_json(
        "post",
        f"/knowledge-stores/{knowledge_store_id}/items",
        {"asset_id": asset_id},
    )


def add_game_video_to_search_index(search_index_id, asset_id):
    return twelvelabs_request_json(
        "post",
        f"/indexes/{search_index_id}/indexed-assets",
        {"asset_id": asset_id, "enable_video_stream": True},
    )


def uploaded_game_payload(game, video_name, asset_id, search_index_id, knowledge_store_item, indexed_asset):
    source_videos = unique_preserving_order([*game.get("source_videos", []), video_name])
    video_reference_map = deepcopy(game.get("video_reference_map", {})) if isinstance(game.get("video_reference_map"), dict) else {}
    video_asset_ids = deepcopy(game.get("video_asset_ids", {})) if isinstance(game.get("video_asset_ids"), dict) else {}
    search_video_ids = deepcopy(game.get("marengo_video_ids", {})) if isinstance(game.get("marengo_video_ids"), dict) else {}

    video_asset_ids[video_name] = asset_id
    indexed_asset_id = response_id(indexed_asset)
    knowledge_store_item_id = response_id(knowledge_store_item)
    if indexed_asset_id:
        search_video_ids[video_name] = indexed_asset_id

    for reference in (video_name, asset_id, indexed_asset_id, knowledge_store_item_id):
        if reference:
            video_reference_map[reference] = video_name

    payload = {
        "tag": game["tag"],
        "label": game["label"],
        "sport": game["sport"],
        "knowledge_store_id": game["knowledge_store_id"],
        "source_videos": source_videos,
        "video_reference_map": video_reference_map,
        "video_asset_ids": video_asset_ids,
        "marengo_index_id": search_index_id,
        "marengo_video_ids": search_video_ids,
    }
    for key in ("wsc_baseline",):
        if key in game:
            payload[key] = deepcopy(game[key])
    return payload


def unique_preserving_order(values):
    seen = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def response_id(value):
    if not isinstance(value, dict):
        return None
    return clean_optional_string(value.get("_id")) or clean_optional_string(value.get("id"))


def pegasus_asset_contexts_for_game(game, video_name=None):
    source_videos = [video_name] if video_name else game.get("source_videos", [])
    contexts = []
    for source_video_name in source_videos:
        if not source_video_name:
            continue
        contexts.extend(pegasus_asset_contexts_for_video(game, source_video_name))
    if not contexts:
        raise ApiError("No Pegasus-ready assets are registered for this game", 404)
    return contexts


def pegasus_asset_contexts_for_video(game, source_video_name):
    asset_id = twelvelabs_asset_id_for_video(game, source_video_name)
    asset = twelvelabs_request_json("get", f"/assets/{asset_id}")
    status = clean_optional_string(asset.get("status"))
    if status and status != "ready":
        raise ApiError(
            {
                "message": "TwelveLabs asset is not ready for Pegasus analysis",
                "asset_id": asset_id,
                "asset_status": status,
            },
            409,
        )
    asset_name = clean_optional_string(asset.get("filename")) or clean_optional_string(asset.get("name")) or source_video_name
    context = pegasus_asset_context(
        source_video_name=source_video_name,
        asset_name=asset_name,
        asset_id=asset_id,
        offset_seconds=0,
        duration_seconds=twelvelabs_asset_duration_seconds(asset),
    )
    return window_pegasus_asset_contexts([context])


def pegasus_asset_contexts_for_index_asset(indexed_asset, source_video_name):
    asset_id = indexed_asset_asset_id(indexed_asset)
    if not asset_id:
        raise ApiError("TwelveLabs asset id not found for indexed video", 404)
    asset = twelvelabs_request_json("get", f"/assets/{asset_id}")
    status = clean_optional_string(asset.get("status"))
    if status and status != "ready":
        raise ApiError(
            {
                "message": "TwelveLabs asset is not ready for Pegasus analysis",
                "asset_id": asset_id,
                "asset_status": status,
            },
            409,
        )
    asset_name = (
        clean_optional_string(asset.get("filename"))
        or clean_optional_string(asset.get("name"))
        or indexed_asset_filename(indexed_asset)
        or source_video_name
    )
    context = pegasus_asset_context(
        source_video_name=source_video_name,
        asset_name=asset_name,
        asset_id=asset_id,
        offset_seconds=0,
        duration_seconds=twelvelabs_asset_duration_seconds(asset) or indexed_asset_duration_seconds(indexed_asset),
    )
    return window_pegasus_asset_contexts([context])


def pegasus_asset_context(source_video_name, asset_name, asset_id, offset_seconds, duration_seconds=None):
    try:
        offset = float(offset_seconds or 0)
    except (TypeError, ValueError):
        offset = 0
    try:
        duration = float(duration_seconds) if duration_seconds is not None else None
    except (TypeError, ValueError):
        duration = None
    context = {
        "source_video_name": source_video_name,
        "asset_name": asset_name,
        "asset_id": asset_id,
        "offset_seconds": offset,
    }
    if duration and duration > 0:
        context["duration_seconds"] = duration
    return context


def unique_pegasus_asset_contexts(contexts):
    seen = set()
    unique_contexts = []
    for context in contexts:
        asset_id = context.get("asset_id")
        if not asset_id or asset_id in seen:
            continue
        seen.add(asset_id)
        unique_contexts.append(context)
    return sorted(unique_contexts, key=lambda item: (item.get("source_video_name", ""), float(item.get("offset_seconds") or 0)))


def twelvelabs_asset_duration_seconds(asset):
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


def float_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def window_pegasus_asset_contexts(contexts):
    windowed_contexts = []
    for context in contexts:
        duration = context.get("duration_seconds")
        if not isinstance(duration, (int, float)) or duration <= PEGASUS_SYNC_WINDOW_SECONDS:
            windowed_contexts.append(context)
            continue

        window_start = 0.0
        while window_start < duration:
            window_end = min(duration, window_start + PEGASUS_SYNC_WINDOW_SECONDS)
            if window_end - window_start < 4:
                break
            window_context = deepcopy(context)
            window_context["window_start_seconds"] = window_start
            window_context["window_end_seconds"] = window_end
            window_context["offset_seconds"] = float(context.get("offset_seconds") or 0) + window_start
            window_context["duration_seconds"] = window_end - window_start
            window_context["asset_name"] = f"{context['asset_name']} window {timecode_from_seconds(window_start)}-{timecode_from_seconds(window_end)}"
            windowed_contexts.append(window_context)
            window_start = window_end
    return windowed_contexts


def generate_game_highlight_reels(tag, payload=None):
    game = get_game(tag)
    payload = payload or {}
    requested_video = payload.get("indexed_asset_id") or payload.get("asset_id") or payload.get("video_name") or payload.get("source_video")
    requested_source_video = payload.get("video_name") or payload.get("source_video")
    video_name = None
    indexed_asset = None
    asset_id = None
    index_id = configured_search_index_id(game)
    if requested_video:
        try:
            video_name = validate_registered_video_name(game, requested_source_video or requested_video)
            asset_id = twelvelabs_asset_id_for_video(game, video_name)
        except ApiError:
            indexed_asset = indexed_asset_for_reference(index_id, requested_video)
            if not indexed_asset:
                raise ApiError("video is not available in the configured TwelveLabs index", 404)
            asset_id = indexed_asset_asset_id(indexed_asset)
            video_name = indexed_asset_workspace_video_name(indexed_asset, requested_source_video or requested_video)

    match_context = payload.get("match_context") or scoped_match_context(game, video_name)
    wsc_baseline = payload.get("wsc_baseline", game.get("wsc_baseline"))
    if indexed_asset:
        asset_contexts = pegasus_asset_contexts_for_index_asset(indexed_asset, video_name)
        indexed_assets = [indexed_asset]
    else:
        asset_contexts = pegasus_asset_contexts_for_game(game, video_name)
        indexed_assets = None
    if not video_name or not asset_id:
        raise ApiError("video_name is required for metadata-backed Workspace analysis", 400)
    return pegasus_highlight_reels_from_index_metadata_or_generate(
        game=game,
        index_id=index_id,
        video_name=video_name,
        asset_id=asset_id,
        asset_contexts=asset_contexts,
        match_context=match_context,
        wsc_baseline=wsc_baseline,
        indexed_assets=indexed_assets,
    )


def pegasus_highlight_reels_from_index_metadata_or_generate(
    game,
    index_id,
    video_name,
    asset_id,
    asset_contexts,
    match_context,
    wsc_baseline,
    indexed_assets=None,
):
    context_hash = pegasus_metadata_context_hash(
        index_id=index_id,
        video_name=video_name,
        asset_id=asset_id,
        asset_contexts=asset_contexts,
        match_context=match_context,
        wsc_baseline=wsc_baseline,
    )
    indexed_assets = indexed_assets or indexed_assets_for_video_metadata(game, index_id, asset_id, video_name)

    for indexed_asset in indexed_assets:
        indexed_asset_id = response_id(indexed_asset)
        cached_reels = pegasus_reels_from_indexed_asset_metadata(indexed_asset, context_hash, asset_id, strict=True)
        if cached_reels and indexed_asset_id:
            return pegasus_reels_response_with_index_metadata(
                reels=cached_reels,
                indexed_asset=indexed_asset,
                index_id=index_id,
                indexed_asset_id=indexed_asset_id,
                asset_id=asset_id,
                context_hash=context_hash,
                video_name=video_name,
                source="indexed_asset_user_metadata",
            )

    for indexed_asset in indexed_assets:
        indexed_asset_id = response_id(indexed_asset)
        cached_reels = pegasus_reels_from_indexed_asset_metadata(indexed_asset, context_hash, asset_id, strict=False)
        if cached_reels and indexed_asset_id:
            return pegasus_reels_response_with_index_metadata(
                reels=cached_reels,
                indexed_asset=indexed_asset,
                index_id=index_id,
                indexed_asset_id=indexed_asset_id,
                asset_id=asset_id,
                context_hash=context_hash,
                video_name=video_name,
                source="indexed_asset_user_metadata",
            )

    indexed_asset = indexed_asset_for_generated_metadata(game, index_id, asset_id, video_name, indexed_assets)
    indexed_asset_id = response_id(indexed_asset)
    if not indexed_asset_id:
        raise ApiError("TwelveLabs indexed asset id is required to store generated analysis", 502)

    reels = generate_pegasus_highlight_reels(
        asset_contexts=asset_contexts,
        match_context=match_context,
        wsc_baseline=wsc_baseline,
        index_id=index_id,
        source_video_name=video_name,
    )
    user_metadata = store_pegasus_reels_index_metadata(index_id, indexed_asset_id, asset_id, context_hash, reels, video_name)
    return pegasus_reels_response_with_user_metadata(
        reels=reels,
        user_metadata=user_metadata,
        index_id=index_id,
        indexed_asset_id=indexed_asset_id,
        asset_id=asset_id,
        context_hash=context_hash,
        video_name=video_name,
        source="generated_and_stored_to_user_metadata",
    )


def indexed_asset_for_generated_metadata(game, index_id, asset_id, video_name, indexed_assets):
    for indexed_asset in indexed_assets:
        if clean_optional_string(indexed_asset.get("asset_id")) == asset_id and response_id(indexed_asset):
            return indexed_asset

    indexed_asset = add_game_video_to_search_index(index_id, asset_id)
    indexed_asset_id = response_id(indexed_asset)
    if not indexed_asset_id:
        raise ApiError("TwelveLabs index response did not include an indexed asset id", 502)
    return indexed_asset


def pegasus_metadata_context_hash(index_id, video_name, asset_id, asset_contexts, match_context, wsc_baseline):
    body = {
        "schema_version": PEGASUS_METADATA_CACHE_SCHEMA_VERSION,
        "model": TWELVELABS_PEGASUS_MODEL,
        "index_id": index_id,
        "video_name": video_name,
        "asset_id": asset_id,
        "asset_contexts": asset_contexts,
        "match_context": match_context,
        "wsc_baseline": wsc_baseline,
    }
    return sha256(json.dumps(body, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def pegasus_reels_from_indexed_asset_metadata(indexed_asset, context_hash, asset_id, strict=True):
    metadata = indexed_asset_user_metadata(indexed_asset)
    if strict and metadata.get(PEGASUS_REELS_ASSET_ID_METADATA_FIELD) != asset_id:
        return None
    if strict and metadata.get(PEGASUS_REELS_HASH_METADATA_FIELD) != context_hash:
        return None
    metadata_model = metadata.get(PEGASUS_REELS_MODEL_METADATA_FIELD)
    if metadata_model and metadata_model != TWELVELABS_PEGASUS_MODEL:
        return None
    raw_reels = metadata.get(PEGASUS_REELS_METADATA_FIELD)
    if not isinstance(raw_reels, str) or not raw_reels.strip():
        detailed_response = parse_json_object(metadata.get(PEGASUS_DETAILED_RESPONSE_METADATA_FIELD))
        reels = detailed_response.get("response") if isinstance(detailed_response.get("response"), dict) else None
        return reels if is_complete_highlight_reels(reels) else None
    try:
        reels = json.loads(raw_reels)
    except json.JSONDecodeError:
        detailed_response = parse_json_object(metadata.get(PEGASUS_DETAILED_RESPONSE_METADATA_FIELD))
        reels = detailed_response.get("response") if isinstance(detailed_response.get("response"), dict) else None
        return reels if is_complete_highlight_reels(reels) else None
    return reels if is_complete_highlight_reels(reels) else None


def store_pegasus_reels_index_metadata(index_id, indexed_asset_id, asset_id, context_hash, reels, video_name=None):
    if not is_complete_highlight_reels(reels):
        return {}
    user_metadata = pegasus_reels_index_user_metadata(index_id, indexed_asset_id, asset_id, context_hash, reels, video_name)
    twelvelabs_request_json(
        "patch",
        f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}",
        {"user_metadata": user_metadata},
    )
    verify_pegasus_reels_index_metadata(index_id, indexed_asset_id, user_metadata)
    return user_metadata


def pegasus_reels_index_user_metadata(index_id, indexed_asset_id, asset_id, context_hash, reels, video_name=None):
    generated_at = timestamp()
    detailed_response = pegasus_detailed_response_metadata(
        index_id=index_id,
        indexed_asset_id=indexed_asset_id,
        asset_id=asset_id,
        context_hash=context_hash,
        reels=reels,
        generated_at=generated_at,
        video_name=video_name,
    )
    return {
        PEGASUS_REELS_METADATA_FIELD: json.dumps(reels, ensure_ascii=False, separators=(",", ":")),
        PEGASUS_DETAILED_RESPONSE_METADATA_FIELD: json.dumps(detailed_response, ensure_ascii=False, separators=(",", ":")),
        PEGASUS_REELS_HASH_METADATA_FIELD: context_hash,
        PEGASUS_REELS_MODEL_METADATA_FIELD: TWELVELABS_PEGASUS_MODEL,
        PEGASUS_REELS_ASSET_ID_METADATA_FIELD: asset_id,
        PEGASUS_REELS_INDEXED_ASSET_ID_METADATA_FIELD: indexed_asset_id,
        PEGASUS_REELS_INDEX_ID_METADATA_FIELD: index_id,
        PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD: video_name or "",
        PEGASUS_REELS_GENERATED_AT_METADATA_FIELD: generated_at,
    }


def pegasus_detailed_response_metadata(index_id, indexed_asset_id, asset_id, context_hash, reels, generated_at, video_name=None):
    return {
        "schema_version": PEGASUS_METADATA_CACHE_SCHEMA_VERSION,
        "provider": "twelvelabs",
        "model": TWELVELABS_PEGASUS_MODEL,
        "index_id": index_id,
        "indexed_asset_id": indexed_asset_id,
        "asset_id": asset_id,
        "source_video_name": video_name,
        "context_hash": context_hash,
        "generated_at": generated_at,
        "clip_counts": pegasus_reels_clip_counts(reels),
        "match_summary": reels.get("match_summary"),
        "response": reels,
    }


def pegasus_reels_clip_counts(reels):
    counts = {}
    for category in HIGHLIGHT_CATEGORY_KEYS:
        body = reels.get(category) if isinstance(reels, dict) else None
        clips = body.get("clips") if isinstance(body, dict) else None
        counts[category] = len(clips) if isinstance(clips, list) else 0
    return counts


def verify_pegasus_reels_index_metadata(index_id, indexed_asset_id, expected_metadata):
    expected_keys = set(expected_metadata)
    last_metadata = {}
    for attempt in range(1, max(1, PEGASUS_METADATA_VERIFY_ATTEMPTS) + 1):
        indexed_asset = twelvelabs_request_json("get", f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}")
        last_metadata = indexed_asset_user_metadata(indexed_asset)
        if pegasus_reels_index_metadata_matches(last_metadata, expected_metadata):
            return
        if attempt < PEGASUS_METADATA_VERIFY_ATTEMPTS and PEGASUS_METADATA_VERIFY_INTERVAL_SECONDS > 0:
            time.sleep(PEGASUS_METADATA_VERIFY_INTERVAL_SECONDS)
    missing = sorted(key for key in expected_keys if key not in last_metadata)
    mismatched = sorted(
        key
        for key in expected_keys
        if key in last_metadata and last_metadata.get(key) != expected_metadata.get(key)
    )
    raise ApiError(
        {
            "message": "Pegasus metadata was not persisted to TwelveLabs indexed asset user_metadata",
            "index_id": index_id,
            "indexed_asset_id": indexed_asset_id,
            "missing_fields": missing,
            "mismatched_fields": mismatched,
        },
        502,
    )


def pegasus_reels_index_metadata_matches(metadata, expected_metadata):
    if not isinstance(metadata, dict):
        return False
    for key, expected_value in expected_metadata.items():
        if metadata.get(key) != expected_value:
            return False
    return True


def pegasus_reels_response_with_index_metadata(
    reels,
    indexed_asset,
    index_id,
    indexed_asset_id,
    asset_id,
    context_hash,
    video_name,
    source,
):
    return pegasus_reels_response_with_user_metadata(
        reels=reels,
        user_metadata=indexed_asset_user_metadata(indexed_asset),
        index_id=index_id,
        indexed_asset_id=indexed_asset_id,
        asset_id=asset_id,
        context_hash=context_hash,
        video_name=video_name,
        source=source,
    )


def pegasus_reels_response_with_user_metadata(
    reels,
    user_metadata,
    index_id,
    indexed_asset_id,
    asset_id,
    context_hash,
    video_name,
    source,
):
    response = deepcopy(reels)
    response[PEGASUS_RESPONSE_METADATA_FIELD] = pegasus_response_metadata_provenance(
        user_metadata=user_metadata,
        reels=reels,
        index_id=index_id,
        indexed_asset_id=indexed_asset_id,
        asset_id=asset_id,
        context_hash=context_hash,
        video_name=video_name,
        source=source,
    )
    return response


def pegasus_response_metadata_provenance(
    user_metadata,
    reels,
    index_id,
    indexed_asset_id,
    asset_id,
    context_hash,
    video_name,
    source,
):
    metadata = user_metadata if isinstance(user_metadata, dict) else {}
    raw_reels = metadata.get(PEGASUS_REELS_METADATA_FIELD)
    raw_detailed = metadata.get(PEGASUS_DETAILED_RESPONSE_METADATA_FIELD)
    detailed_response = parse_json_object(raw_detailed)
    clip_counts = detailed_response.get("clip_counts") if isinstance(detailed_response.get("clip_counts"), dict) else None
    return {
        "source": source,
        "from_user_metadata": source == "indexed_asset_user_metadata",
        "storage": "indexed_asset_user_metadata",
        "provider": "twelvelabs",
        "model": metadata.get(PEGASUS_REELS_MODEL_METADATA_FIELD) or TWELVELABS_PEGASUS_MODEL,
        "index_id": metadata.get(PEGASUS_REELS_INDEX_ID_METADATA_FIELD) or index_id,
        "indexed_asset_id": metadata.get(PEGASUS_REELS_INDEXED_ASSET_ID_METADATA_FIELD) or indexed_asset_id,
        "asset_id": metadata.get(PEGASUS_REELS_ASSET_ID_METADATA_FIELD) or asset_id,
        "source_video_name": metadata.get(PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD) or video_name,
        "generated_at": metadata.get(PEGASUS_REELS_GENERATED_AT_METADATA_FIELD),
        "context_hash": metadata.get(PEGASUS_REELS_HASH_METADATA_FIELD) or context_hash,
        "metadata_fields": sorted(key for key in pegasus_reels_metadata_fields() if key in metadata),
        "reels_metadata_field": PEGASUS_REELS_METADATA_FIELD,
        "detailed_response_metadata_field": PEGASUS_DETAILED_RESPONSE_METADATA_FIELD,
        "reels_response_chars": len(raw_reels) if isinstance(raw_reels, str) else 0,
        "detailed_response_chars": len(raw_detailed) if isinstance(raw_detailed, str) else 0,
        "clip_counts": clip_counts or pegasus_reels_clip_counts(reels),
    }


def pegasus_reels_metadata_fields():
    return [
        PEGASUS_REELS_METADATA_FIELD,
        PEGASUS_DETAILED_RESPONSE_METADATA_FIELD,
        PEGASUS_REELS_HASH_METADATA_FIELD,
        PEGASUS_REELS_MODEL_METADATA_FIELD,
        PEGASUS_REELS_ASSET_ID_METADATA_FIELD,
        PEGASUS_REELS_INDEXED_ASSET_ID_METADATA_FIELD,
        PEGASUS_REELS_INDEX_ID_METADATA_FIELD,
        PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD,
        PEGASUS_REELS_GENERATED_AT_METADATA_FIELD,
    ]


def parse_json_object(value):
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


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


def indexed_assets_for_video_metadata(game, index_id, asset_id, video_name=None):
    candidates = []
    seen = set()

    def add_candidate(indexed_asset):
        indexed_asset_id = response_id(indexed_asset)
        candidate_key = indexed_asset_id or json.dumps(indexed_asset, sort_keys=True, default=str)
        if candidate_key in seen:
            return
        seen.add(candidate_key)
        if indexed_asset_id and not indexed_asset_user_metadata(indexed_asset):
            try:
                indexed_asset = twelvelabs_request_json("get", f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}")
            except ApiError:
                pass
        candidates.append(indexed_asset)

    indexed_assets = twelvelabs_request_json("get", f"/assets/{asset_id}/indexed-assets")
    for indexed_asset in indexed_assets.get("data", []):
        if indexed_asset_index_id(indexed_asset) == index_id:
            add_candidate(indexed_asset)

    indexed_asset_id = marengo_video_id_for_video_name(game, video_name)
    if indexed_asset_id:
        try:
            add_candidate(twelvelabs_request_json("get", f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}"))
        except ApiError:
            pass

    for indexed_asset in list_indexed_assets(index_id):
        if indexed_asset_matches_video(game, indexed_asset, asset_id, video_name):
            add_candidate(indexed_asset)

    return candidates


def list_indexed_assets(index_id):
    indexed_assets = []
    page = 1
    while page <= 10:
        path = f"/indexes/{index_id}/indexed-assets"
        if page > 1:
            path = f"{path}?page={page}"
        body = twelvelabs_request_json("get", path)
        data = body.get("data")
        if isinstance(data, list):
            indexed_assets.extend(item for item in data if isinstance(item, dict))
        page_info = body.get("page_info") if isinstance(body.get("page_info"), dict) else {}
        total_pages = int(page_info.get("total_page") or page)
        if page >= total_pages:
            break
        page += 1
    return indexed_assets


def normalize_index_video(index_id, indexed_asset):
    indexed_asset_id = response_id(indexed_asset)
    asset_id = indexed_asset_asset_id(indexed_asset)
    filename = indexed_asset_filename(indexed_asset)
    metadata = indexed_asset_user_metadata(indexed_asset)
    detailed_response = parse_json_object(metadata.get(PEGASUS_DETAILED_RESPONSE_METADATA_FIELD))
    clip_counts = detailed_response.get("clip_counts") if isinstance(detailed_response.get("clip_counts"), dict) else None
    metadata_source = clean_optional_string(metadata.get(PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD))
    display_name = metadata_source or filename or indexed_asset_display_name(indexed_asset) or indexed_asset_id or asset_id or "Indexed video"
    return {
        "id": indexed_asset_id or asset_id or display_name,
        "index_id": index_id,
        "indexed_asset_id": indexed_asset_id,
        "asset_id": asset_id,
        "name": filename or indexed_asset_display_name(indexed_asset) or display_name,
        "display_name": display_name,
        "source_video_name": metadata_source or filename,
        "status": indexed_asset_status(indexed_asset),
        "thumbnail_url": indexed_asset_thumbnail_url(indexed_asset),
        "duration_seconds": indexed_asset_duration_seconds(indexed_asset),
        "selectable": bool(indexed_asset_id or asset_id or filename or metadata_source),
        "has_pegasus_metadata": bool(
            metadata.get(PEGASUS_REELS_METADATA_FIELD)
            or metadata.get(PEGASUS_DETAILED_RESPONSE_METADATA_FIELD)
        ),
        "metadata_generated_at": clean_optional_string(metadata.get(PEGASUS_REELS_GENERATED_AT_METADATA_FIELD)),
        "metadata_source_video_name": metadata_source,
        "metadata_clip_counts": clip_counts,
    }


def indexed_asset_with_user_metadata(index_id, indexed_asset):
    indexed_asset_id = response_id(indexed_asset)
    if not indexed_asset_id or indexed_asset_user_metadata(indexed_asset):
        return indexed_asset
    try:
        hydrated = twelvelabs_request_json("get", f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}")
    except ApiError:
        return indexed_asset
    return hydrated if isinstance(hydrated, dict) else indexed_asset


def indexed_asset_for_reference(index_id, reference):
    reference = clean_optional_string(reference)
    if not reference:
        return None

    if "/" not in reference and "." not in reference:
        try:
            indexed_asset = twelvelabs_request_json("get", f"/indexes/{index_id}/indexed-assets/{reference}")
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
        clean_optional_string(metadata.get(PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD)),
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
        clean_optional_string(metadata.get(PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD))
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


def indexed_asset_matches_video(game, indexed_asset, asset_id, video_name=None):
    if not isinstance(indexed_asset, dict):
        return False
    indexed_asset_id = response_id(indexed_asset)
    candidate_asset_id = indexed_asset_asset_id(indexed_asset)
    filename = indexed_asset_filename(indexed_asset)
    metadata = indexed_asset_user_metadata(indexed_asset)
    metadata_source = clean_optional_string(metadata.get(PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD))

    if candidate_asset_id and candidate_asset_id == asset_id:
        return True
    if video_name and metadata_source == video_name:
        return True
    if video_name and filename == video_name:
        return True

    reference_map = game.get("video_reference_map", {}) if isinstance(game, dict) else {}
    if isinstance(reference_map, dict):
        for reference in (indexed_asset_id, candidate_asset_id, filename):
            if reference and reference_map.get(reference) == video_name:
                return True

    if video_name and filename:
        source_stem = Path(video_name).stem.lower()
        filename_stem = Path(filename).stem.lower()
        if filename_stem == source_stem or filename_stem.startswith(f"{source_stem} part"):
            return True
    return False


def indexed_asset_filename(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    system_metadata = indexed_asset.get("system_metadata")
    if isinstance(system_metadata, dict):
        filename = clean_optional_string(system_metadata.get("filename"))
        if filename:
            return filename
    return clean_optional_string(indexed_asset.get("filename")) or clean_optional_string(indexed_asset.get("name"))


def indexed_asset_id_for_asset(game, index_id, asset_id, video_name=None):
    indexed_assets = twelvelabs_request_json("get", f"/assets/{asset_id}/indexed-assets")
    for indexed_asset in indexed_assets.get("data", []):
        if indexed_asset_index_id(indexed_asset) == index_id:
            indexed_asset_id = response_id(indexed_asset)
            if indexed_asset_id:
                return indexed_asset_id

    indexed_asset_id = marengo_video_id_for_video_name(game, video_name)
    if indexed_asset_id:
        return indexed_asset_id
    raise ApiError(
        {
            "message": (
                "TwelveLabs indexed asset id was not found for this video and INDEX_ID. "
                "Workspace will create indexed metadata before generating analysis."
            ),
            "index_id": index_id,
            "asset_id": asset_id,
            "source_video_name": video_name,
        },
        404,
    )


def indexed_asset_index_id(indexed_asset):
    if not isinstance(indexed_asset, dict):
        return None
    index = indexed_asset.get("index")
    if isinstance(index, dict):
        return clean_optional_string(index.get("_id")) or clean_optional_string(index.get("id"))
    return clean_optional_string(indexed_asset.get("index_id")) or clean_optional_string(indexed_asset.get("indexId"))


def is_complete_highlight_reels(reels):
    if not isinstance(reels, dict) or not HIGHLIGHT_RESPONSE_KEYS.issubset(reels.keys()):
        return False
    if not isinstance(reels.get("match_summary"), str) or not reels["match_summary"].strip():
        return False
    for category in HIGHLIGHT_CATEGORY_KEYS:
        body = reels.get(category)
        if not isinstance(body, dict):
            return False
        if not isinstance(body.get("clips"), list):
            return False
        if not isinstance(body.get("assembly_notes"), list):
            return False
    return True


def search_game_videos(tag, payload=None):
    game = get_game(tag)
    payload = payload or {}
    query = required_payload_string(payload, "query")
    limit = optional_payload_int(payload.get("limit"), "limit", default=12, minimum=1, maximum=24)
    requested_video = payload.get("video_name") or payload.get("source_video")
    video_name = validate_registered_video_name(game, requested_video) if requested_video else None
    filter_key = optional_payload_string(payload.get("filter"), "filter") if payload.get("filter") else None
    if filter_key == "all":
        filter_key = None
    if filter_key and filter_key not in MARENGO_SEARCH_FILTER_QUERIES:
        raise ApiError("filter is not supported", 400)

    return search_game_videos_with_marengo(game, query, limit, filter_key, video_name, payload, configured_search_index_id(game))


def search_game_videos_with_marengo(game, query, limit, filter_key, video_name, payload, marengo_index_id):
    search_options = validate_marengo_search_options(payload.get("search_options"))
    group_by = validate_marengo_group_by(payload.get("group_by"))
    fields = [
        ("query_text", marengo_query_text(query, filter_key)),
        ("index_id", marengo_index_id),
        ("group_by", group_by),
        ("operator", "or"),
        ("page_limit", str(limit)),
        ("include_user_metadata", "true"),
        ("search_options", search_options),
    ]
    if video_name:
        marengo_video_id = marengo_video_id_for_video_name(game, video_name)
        if marengo_video_id:
            fields.append(("filter", json.dumps({"id": [marengo_video_id]})))
        else:
            fields.append(("filter", json.dumps({"filename": video_name})))

    result = twelvelabs_request_form("post", "/search", fields)
    return normalize_marengo_search(game, query, result, limit, search_options, group_by)


def create_jockey_chat_response(tag, payload=None):
    game = get_game(tag)
    payload = payload or {}
    message = required_payload_string(payload, "message")
    include_reel = payload.get("include_reel")
    include_reel = bool(include_reel) if include_reel is not None else jockey_message_requests_reel(message)
    default_limit = 1 if include_reel and jockey_message_requests_specific_clip(message) else 8 if include_reel else 0
    limit = optional_payload_int(payload.get("limit"), "limit", default=default_limit, minimum=0, maximum=16)
    if not include_reel:
        limit = 0
    session_id = clean_optional_string(payload.get("session_id"))
    requested_video = payload.get("video_name") or payload.get("source_video")
    video_name = validate_registered_video_name(game, requested_video) if requested_video else None

    request_body = {
        "model": TWELVELABS_MODEL,
        "instructions": jockey_chat_instructions(),
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": jockey_chat_prompt(game, message, limit, video_name, include_reel),
            }
        ],
        "knowledge_store_id": game["knowledge_store_id"],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "jockey_highlight_manifest",
                "schema": JOCKEY_CHAT_SCHEMA,
            }
        },
    }
    if session_id:
        request_body["session_id"] = session_id

    result = twelvelabs_request_json("post", "/responses", request_body)
    manifest = parse_jockey_response_json(result, "TwelveLabs Jockey chat response")
    return normalize_jockey_chat_manifest(game, message, result, manifest, limit)


def jockey_chat_instructions():
    return (
        "You are a senior sports highlight producer using TwelveLabs Jockey over a sports knowledge store. "
        "Use only indexed video evidence. Answer conversational producer questions plainly, and build clip manifests only when the request asks for a reel, specific clip, playable moment, or showcase highlight. "
        "Return JSON only. Do not invent timestamps, filenames, scores, players, clip rationale, or intensity."
    )


def jockey_chat_prompt(game, message, limit, video_name=None, include_reel=False):
    parts = [
        "Producer request:",
        message,
        "Always return a concise narrative_summary.",
        f"Game context: {game['label']} ({game['sport']}).",
        "Registered source videos: " + "; ".join(game.get("source_videos", [])),
    ]
    if include_reel:
        parts.extend(
            [
                f"Return up to {limit} ranked clips for a simple Jockey reel or clip showcase.",
                "Each clip must include video_reference, start_time, end_time, moment_type, emotional_intensity, jockey_rationale, and highlight_potential.",
                "Use timecodes like M:SS or H:MM:SS. Choose short, playable ranges.",
                "Rank clips by editorial value and highlight_potential descending.",
            ]
        )
    else:
        parts.append("This is not a reel request. Return an empty clips array and keep the answer conversational.")
    if video_name:
        parts.append(f"Search only this registered source video: {video_name}.")
    else:
        parts.append("You may reason across every registered source video in this knowledge store.")
    parts.append("If no grounded matches exist, return an empty clips array with a concise narrative_summary.")
    return "\n".join(parts)


def jockey_message_requests_reel(message):
    return bool(
        re.search(
            r"\b(reels?|clips?|moments?|showcase|play|highlights?)\b|\bshow\s+me\b.*\b(clip|moment|highlight|play|reel)\b",
            message or "",
            flags=re.IGNORECASE,
        )
    )


def jockey_message_requests_specific_clip(message):
    return bool(
        re.search(
            r"\b(one|single|specific|that|this)\b.*\b(reel|clip|moment|highlight|play)\b|\b(showcase|show\s+me|play)\b.*\b(clip|moment|highlight|play)\b",
            message or "",
            flags=re.IGNORECASE,
        )
    )


def parse_jockey_response_json(result, source_label):
    for output in result.get("output", []):
        if output.get("type") != "message":
            continue
        for content in output.get("content", []):
            text = content.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            try:
                return json.loads(text)
            except json.JSONDecodeError as exc:
                raise ApiError(f"{source_label} text was not valid JSON", 502) from exc
    raise ApiError(f"{source_label} did not include message text", 502)


def normalize_jockey_chat_manifest(game, message, result, manifest, limit):
    if not isinstance(manifest, dict):
        raise ApiError("TwelveLabs Jockey chat response was not an object", 502)
    raw_clips = manifest.get("clips", [])
    if not isinstance(raw_clips, list):
        raise ApiError("TwelveLabs Jockey chat clips was not an array", 502)

    clips = []
    for index, raw_clip in enumerate(raw_clips[:limit]):
        if not isinstance(raw_clip, dict):
            continue
        normalized = normalize_jockey_chat_clip(game, raw_clip, index)
        if normalized:
            clips.append(normalized)

    return {
        "session_id": clean_optional_string(result.get("session_id")) or clean_optional_string(result.get("id")),
        "message": message,
        "narrative_summary": clean_optional_string(manifest.get("narrative_summary"))
        or "No grounded Jockey-curated moments were returned for this request.",
        "clips": clips,
    }


def normalize_jockey_chat_clip(game, raw_clip, index):
    reference = clean_optional_string(raw_clip.get("video_reference"))
    start_time = clean_optional_string(raw_clip.get("start_time"))
    end_time = clean_optional_string(raw_clip.get("end_time"))
    rationale = clean_optional_string(raw_clip.get("jockey_rationale"))
    if not reference or not start_time or not rationale:
        return None

    end_time = end_time or default_end_time(start_time)
    video_name = video_name_for_reference(game, reference)
    potential = raw_clip.get("highlight_potential")
    if not isinstance(potential, (int, float)):
        potential = 0
    potential = min(1, max(0, float(potential)))

    return {
        "id": f"jockey-chat-{index}-{sha256(json.dumps(raw_clip, sort_keys=True, default=str).encode()).hexdigest()[:12]}",
        "video_name": video_name,
        "video_reference": reference,
        "start_time": start_time,
        "end_time": end_time,
        "moment_type": clean_optional_string(raw_clip.get("moment_type")) or "jockey_curated",
        "emotional_intensity": clean_optional_string(raw_clip.get("emotional_intensity")) or "unknown",
        "jockey_rationale": rationale,
        "highlight_potential": potential,
        "source_asset_id": asset_id_for_video_name(game, video_name) if video_name else None,
    }


def validate_marengo_search_options(value):
    if value is None:
        return ["visual", "audio"]
    if isinstance(value, str):
        raw_options = [part.strip() for part in value.split(",")]
    elif isinstance(value, list):
        raw_options = value
    else:
        raise ApiError("search_options must be an array", 400)

    search_options = []
    for option in raw_options:
        if not isinstance(option, str) or not option.strip():
            continue
        clean_option = option.strip()
        if clean_option not in MARENGO_SEARCH_OPTIONS:
            raise ApiError("search_options contains an unsupported option", 400)
        if clean_option not in search_options:
            search_options.append(clean_option)
    return search_options or ["visual", "audio"]


def validate_marengo_group_by(value):
    if value is None:
        return "clip"
    if not isinstance(value, str) or not value.strip():
        raise ApiError("group_by must be a string", 400)
    group_by = value.strip()
    if group_by not in MARENGO_SEARCH_GROUP_BY:
        raise ApiError("group_by must be clip", 400)
    return group_by


def marengo_query_text(query, filter_key=None):
    filter_query = MARENGO_SEARCH_FILTER_QUERIES.get(filter_key)
    return f"{query} {filter_query}" if filter_query else query


def normalize_marengo_search(game, query, result, limit, search_options, group_by):
    raw_results = result.get("data", [])
    if not isinstance(raw_results, list):
        raise ApiError("TwelveLabs Marengo search response data was not an array", 502)

    results = []
    for index, raw_result in enumerate(raw_results[:limit]):
        if not isinstance(raw_result, dict):
            continue
        normalized = normalize_marengo_search_result(game, query, raw_result, index)
        if normalized:
            results.append(normalized)

    search_pool = result.get("search_pool") if isinstance(result.get("search_pool"), dict) else {}
    return {
        "provider": "marengo",
        "model": "marengo3.0",
        "query": query,
        "query_interpretation": f"Matched visual/audio evidence for: {query}",
        "total_results": len(results),
        "search_options": search_options,
        "group_by": group_by,
        "search_pool": {
            "index_configured": True,
            "total_count": search_pool.get("total_count"),
            "total_duration": search_pool.get("total_duration"),
        },
        "results": results,
    }


def normalize_marengo_search_result(game, query, raw_result, index):
    reference = clean_optional_string(raw_result.get("video_id")) or clean_optional_string(raw_result.get("id"))
    if not reference:
        return None
    video_name = video_name_for_marengo_result(game, raw_result, reference)
    if not video_name:
        return None

    start_seconds = raw_result.get("start")
    end_seconds = raw_result.get("end")
    start_time = timecode_from_seconds(start_seconds if isinstance(start_seconds, (int, float)) else 0)
    end_time = timecode_from_seconds(end_seconds if isinstance(end_seconds, (int, float)) else (seconds_from_timecode(start_time) or 0) + 12)
    rank = raw_result.get("rank")
    confidence = rank_to_confidence(rank, index)
    transcription = clean_optional_string(raw_result.get("transcription"))
    title = f"{query} match"
    description = transcription or f"Found a visual/audio match for \"{query}\"."
    relevance = f"Rank {rank if isinstance(rank, int) else index + 1} result from visual/audio search."

    return {
        "id": f"marengo-{index}-{sha256(json.dumps(raw_result, sort_keys=True, default=str).encode()).hexdigest()[:12]}",
        "provider": "marengo",
        "video_reference": reference,
        "video_name": video_name,
        "timestamp": start_time,
        "start_time": start_time,
        "end_time": end_time,
        "title": title,
        "description": description,
        "relevance": relevance,
        "confidence": confidence,
        "rank": rank,
        "thumbnail_url": clean_optional_string(raw_result.get("thumbnail_url")),
        "source_asset_id": asset_id_for_video_name(game, video_name),
    }


def video_name_for_marengo_result(game, raw_result, reference):
    video_name = video_name_for_reference(game, reference)
    if video_name:
        return video_name
    for key in ("asset_id", "indexed_asset_id", "thumbnail_url"):
        candidate = clean_optional_string(raw_result.get(key))
        if not candidate:
            continue
        video_name = video_name_for_reference(game, candidate)
        if video_name:
            return video_name
    user_metadata = raw_result.get("user_metadata") or raw_result.get("userMetadata")
    if isinstance(user_metadata, dict):
        for key in ("video_name", "filename", "source_video", "source_name"):
            candidate = clean_optional_string(user_metadata.get(key))
            if candidate and candidate in set(game.get("source_videos", [])):
                return candidate
            if candidate:
                mapped = video_name_for_reference(game, candidate)
                if mapped:
                    return mapped
    return None


def rank_to_confidence(rank, index):
    if isinstance(rank, int) and rank > 0:
        return max(0.1, min(1, 1 - ((rank - 1) * 0.08)))
    return max(0.1, min(1, 1 - (index * 0.08)))


def default_end_time(start_time):
    seconds = seconds_from_timecode(start_time)
    if seconds is None:
        return start_time
    return timecode_from_seconds(seconds + 12)


def seconds_from_timecode(value):
    if not isinstance(value, str) or not value.strip():
        return None
    parts = value.strip().split(":")
    if not 1 <= len(parts) <= 3:
        return None
    total = 0
    for part in parts:
        try:
            number = int(float(part))
        except ValueError:
            return None
        total = total * 60 + number
    return total


def timecode_from_seconds(total_seconds):
    total_seconds = max(0, int(round(total_seconds)))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def registered_video_path(tag, video_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    path = video_path(video_name)
    if not path.exists():
        raise ApiError("video file not found", 404)
    return path


def registered_thumbnail_path(tag, video_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    path = thumbnail_path(video_name)
    if not path.exists():
        raise ApiError("thumbnail file not found", 404)
    return path


def registered_thumbnail_path_or_none(tag, video_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    path = thumbnail_path(video_name)
    return path if path.exists() else None


def placeholder_thumbnail_svg(tag, video_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    title = escape_svg_text(Path(video_name).stem)
    label = escape_svg_text(game.get("label", tag))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="{title}">
  <rect width="1280" height="720" fill="#1D1C1B"/>
  <rect x="64" y="64" width="1152" height="592" rx="18" fill="#F7F5F2"/>
  <rect x="96" y="96" width="1088" height="528" rx="12" fill="#FFFFFF" stroke="#D3D1CF"/>
  <circle cx="178" cy="174" r="36" fill="#00DC82"/>
  <path d="M170 154v40l32-20-32-20Z" fill="#1D1C1B"/>
  <text x="96" y="312" fill="#707070" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="3">{label}</text>
  <text x="96" y="372" fill="#1D1C1B" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="700">{title}</text>
  <text x="96" y="440" fill="#707070" font-family="Inter, Arial, sans-serif" font-size="26">Live TwelveLabs asset stream</text>
</svg>"""


def twelvelabs_stream_info(tag, video_name):
    game = get_game(tag)
    requested_video = clean_optional_string(video_name)
    if not requested_video:
        raise ApiError("video_name is required", 404)
    try:
        resolved_video_name = validate_registered_video_name(game, requested_video, status_code=404)
        asset_id = twelvelabs_asset_id_for_video(game, resolved_video_name)
    except ApiError:
        index_id = configured_search_index_id(game)
        indexed_asset = indexed_asset_for_reference(index_id, requested_video)
        if not indexed_asset:
            raise ApiError("video is not available in the configured TwelveLabs index", 404)
        asset_id = indexed_asset_asset_id(indexed_asset)
        resolved_video_name = indexed_asset_workspace_video_name(indexed_asset, requested_video)
    if not asset_id:
        raise ApiError("TwelveLabs asset id not found for this video", 404)
    cache_key = (tag, resolved_video_name, asset_id)
    now = time.time()
    with STREAM_INFO_CACHE_LOCK:
        cached = STREAM_INFO_CACHE.get(cache_key)
        if cached and cached.get("expires_at", 0) > now:
            return dict(cached["stream_info"])

    asset = twelvelabs_request_json("get", f"/assets/{asset_id}")
    hls = asset.get("hls") or {}
    manifest_url = hls.get("manifest_url")
    hls_status = hls.get("status")
    if not manifest_url or hls_status != "ready":
        raise ApiError(
            {
                "message": "TwelveLabs HLS stream is not ready for this video",
                "asset_id": asset_id,
                "asset_status": asset.get("status"),
                "hls_status": hls_status or "missing",
            },
            409,
        )
    stream_info = {
        "provider": "twelvelabs",
        "type": "hls",
        "asset_id": asset_id,
        "asset_status": asset.get("status"),
        "hls_status": hls_status,
        "manifest_url": manifest_url,
    }
    if STREAM_INFO_CACHE_TTL_SECONDS > 0:
        with STREAM_INFO_CACHE_LOCK:
            STREAM_INFO_CACHE[cache_key] = {
                "expires_at": now + STREAM_INFO_CACHE_TTL_SECONDS,
                "stream_info": stream_info,
            }
    return stream_info


def twelvelabs_asset_id_for_video(game, video_name):
    asset_ids = game.get("video_asset_ids", {})
    if isinstance(asset_ids, dict) and asset_ids.get(video_name):
        return asset_ids[video_name]

    raise ApiError("TwelveLabs asset id not found for this video", 404)


def generated_reel_clip(tag, video_name, start, end, format_name, clip_name=None):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    stream_info = twelvelabs_stream_info(tag, video_name)
    source_input = stream_info["manifest_url"]
    start_seconds = parse_reel_seconds(start, "start")
    end_seconds = parse_reel_seconds(end, "end")
    if end_seconds <= start_seconds:
        raise ApiError("end must be greater than start", 400)
    duration = end_seconds - start_seconds
    if duration > 10 * 60:
        raise ApiError("reel duration must be 10 minutes or less", 400)

    format_key = (format_name or "9x16").strip()
    reel_format = REEL_FORMATS.get(format_key)
    if not reel_format:
        raise ApiError(f"unsupported reel format: {format_name}", 400)

    REELS_DIR.mkdir(parents=True, exist_ok=True)
    source_slug = slugify_filename(Path(video_name).stem)
    safe_label = slugify_filename(clip_name or "reel")
    cache_hash = sha256(
        f"{tag}|{video_name}|{stream_info.get('asset_id')}|hls|{start_seconds:.3f}|{end_seconds:.3f}|{format_key}".encode()
    ).hexdigest()[:16]
    output_path = REELS_DIR / (
        f"{source_slug}-{safe_label}-{format_key}-{int(start_seconds * 1000)}-{int(end_seconds * 1000)}-{cache_hash}.mp4"
    )
    if not output_path.exists():
        render_reel_clip(source_input, output_path, start_seconds, duration, reel_format)
    download_name = f"{source_slug}-{safe_label}-{reel_format['label'].replace(':', 'x')}-{int(start_seconds)}-{int(end_seconds)}.mp4"
    return output_path, download_name


def generated_reel_thumbnail(tag, video_name, time, format_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    stream_info = twelvelabs_stream_info(tag, video_name)
    source_input = stream_info["manifest_url"]
    time_seconds = parse_reel_seconds(time, "time")
    format_key = (format_name or "9x16").strip()
    reel_format = REEL_FORMATS.get(format_key)
    if not reel_format:
        raise ApiError(f"unsupported reel format: {format_name}", 400)

    REEL_THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    source_slug = slugify_filename(Path(video_name).stem)
    cache_hash = sha256(
        f"{tag}|{video_name}|{stream_info.get('asset_id')}|hls|{time_seconds:.3f}|{format_key}|thumbnail".encode()
    ).hexdigest()[:16]
    output_path = REEL_THUMBNAILS_DIR / f"{source_slug}-{format_key}-{int(time_seconds * 1000)}-{cache_hash}.jpg"
    if not output_path.exists():
        render_reel_thumbnail(source_input, output_path, time_seconds, reel_format)
    return output_path


def render_reel_clip(source_path, output_path, start_seconds, duration, reel_format):
    width = reel_format["width"]
    height = reel_format["height"]
    video_filter = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(source_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        video_filter,
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
        str(output_path),
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=max(120, int(duration * 4) + 30),
        check=False,
    )
    if result.returncode != 0:
        try:
            output_path.unlink(missing_ok=True)
        except OSError:
            pass
        detail = (result.stderr or result.stdout or "ffmpeg failed").strip()
        raise ApiError(f"reel export failed: {detail}", 500)


def render_reel_thumbnail(source_path, output_path, time_seconds, reel_format):
    width = reel_format["width"]
    height = reel_format["height"]
    video_filter = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{time_seconds:.3f}",
        "-i",
        str(source_path),
        "-frames:v",
        "1",
        "-vf",
        video_filter,
        "-q:v",
        "3",
        str(output_path),
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        try:
            output_path.unlink(missing_ok=True)
        except OSError:
            pass
        detail = (result.stderr or result.stdout or "ffmpeg failed").strip()
        raise ApiError(f"reel thumbnail failed: {detail}", 500)


def parse_reel_seconds(value, field_name):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field_name} must be a number of seconds", 400)
    if seconds < 0:
        raise ApiError(f"{field_name} must be zero or greater", 400)
    return seconds


def slugify_filename(value):
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:80] or "reel"


def game_path(tag):
    return GAMES_DIR / f"{tag}.json"


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def video_path(video_name):
    if Path(video_name).name != video_name:
        raise ApiError("video_name must be a file name", 400)
    return VIDEOS_DIR / video_name


def thumbnail_path(video_name):
    if Path(video_name).name != video_name:
        raise ApiError("video_name must be a file name", 400)
    return THUMBNAILS_DIR / f"{video_name}.jpg"


def escape_svg_text(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def filter_highlight_reels_for_video(game, reels, video_name):
    scoped = deepcopy(reels)
    scoped["match_summary"] = f"{video_name} scoped highlight reel from {game['label']}."
    for key in HIGHLIGHT_CATEGORY_KEYS:
        category = scoped.get(key, {})
        clips = category.get("clips", [])
        category["clips"] = [
            clip
            for clip in clips
            if clip_video_name(game, clip) == video_name
        ]
        category["assembly_notes"] = filter_assembly_notes(category.get("assembly_notes", []), video_name)
    return scoped


def filter_assembly_notes(notes, video_name):
    if not isinstance(notes, list):
        return []
    normalized = video_name.lower()
    return [
        note
        for note in notes
        if isinstance(note, str) and normalized in note.lower()
    ]


def clip_video_name(game, clip):
    if not isinstance(clip, dict):
        return None
    reference = clip.get("video_reference")
    return video_name_for_reference(game, reference)


def video_name_for_reference(game, reference):
    if not isinstance(reference, str) or not reference.strip():
        return None
    reference = reference.strip()
    source_videos = set(game.get("source_videos", []))
    reference_map = game.get("video_reference_map", {})
    if isinstance(reference_map, dict) and reference in reference_map:
        return reference_map[reference]
    if reference in source_videos:
        return reference

    asset_map = game.get("video_asset_ids", {})
    if isinstance(asset_map, dict):
        for video_name, asset_id in asset_map.items():
            if asset_id == reference:
                return video_name
            if isinstance(asset_id, str) and asset_id.strip() and asset_id in reference:
                return video_name

    marengo_video_ids = game.get("marengo_video_ids", {})
    if isinstance(marengo_video_ids, dict):
        for video_name, marengo_video_id in marengo_video_ids.items():
            if marengo_video_id == reference:
                return video_name
            if isinstance(marengo_video_id, str) and marengo_video_id.strip() and marengo_video_id in reference:
                return video_name

    basename = Path(reference).name
    if basename in source_videos:
        return basename

    normalized_reference = reference.lower()
    for video_name in source_videos:
        normalized_video = video_name.lower()
        if normalized_reference == normalized_video:
            return video_name
        if normalized_video in normalized_reference or normalized_reference in normalized_video:
            return video_name
        if Path(video_name).stem.lower() in normalized_reference:
            return video_name
    return None


def asset_id_for_video_name(game, video_name):
    if not video_name:
        return None
    video_asset_ids = game.get("video_asset_ids", {})
    if not isinstance(video_asset_ids, dict):
        return None
    asset_id = video_asset_ids.get(video_name)
    return asset_id if isinstance(asset_id, str) and asset_id.strip() else None


def marengo_video_id_for_video_name(game, video_name):
    if not video_name:
        return None
    marengo_video_ids = game.get("marengo_video_ids", {})
    if not isinstance(marengo_video_ids, dict):
        return None
    marengo_video_id = marengo_video_ids.get(video_name)
    return marengo_video_id if isinstance(marengo_video_id, str) and marengo_video_id.strip() else None


def validate_registered_video_name(game, video_name, status_code=400):
    if not isinstance(video_name, str) or not video_name.strip():
        raise ApiError("video_name must be a registered source video name", status_code)
    clean_name = video_name.strip()
    if clean_name not in set(game.get("source_videos", [])):
        raise ApiError("video is not registered for this game", status_code)
    return clean_name


def scoped_match_context(game, video_name=None):
    if not video_name:
        return f"{game['label']} ({game['sport']})"
    return (
        f"{game['label']} ({game['sport']}) source video: {video_name}. "
        "Use only this one source video. Do not blend facts, clips, players, scores, or timestamps "
        "from other videos in the knowledge store."
    )


def validate_source_videos(source_videos):
    if source_videos is None:
        return []
    if not isinstance(source_videos, list):
        raise ApiError("source_videos must be an array", 400)

    validated = []
    for video_name in source_videos:
        if not isinstance(video_name, str) or not video_name.strip():
            raise ApiError("source_videos must contain only non-empty strings", 400)
        clean_name = video_name.strip()
        path = video_path(clean_name)
        if not path.exists():
            raise ApiError(f"source video not found: {clean_name}", 400)
        validated.append(clean_name)
    return validated


def validate_video_reference_map(video_reference_map, source_videos):
    if video_reference_map is None:
        return {}
    if not isinstance(video_reference_map, dict):
        raise ApiError("video_reference_map must be an object", 400)

    source_video_set = set(source_videos)
    validated = {}
    for video_reference, video_name in video_reference_map.items():
        if not isinstance(video_reference, str) or not video_reference.strip():
            raise ApiError("video_reference_map keys must be non-empty strings", 400)
        if not isinstance(video_name, str) or not video_name.strip():
            raise ApiError("video_reference_map values must be non-empty strings", 400)
        clean_name = video_name.strip()
        if clean_name not in source_video_set:
            raise ApiError(f"video_reference_map value is not a registered source video: {clean_name}", 400)
        validated[video_reference.strip()] = clean_name
    return validated


def validate_video_asset_ids(video_asset_ids, source_videos):
    if video_asset_ids is None:
        return {}
    if not isinstance(video_asset_ids, dict):
        raise ApiError("video_asset_ids must be an object", 400)

    source_video_set = set(source_videos)
    validated = {}
    for video_name, asset_id in video_asset_ids.items():
        if not isinstance(video_name, str) or not video_name.strip():
            raise ApiError("video_asset_ids keys must be source video names", 400)
        clean_video_name = video_name.strip()
        if clean_video_name not in source_video_set:
            raise ApiError(f"video_asset_ids key is not a registered source video: {clean_video_name}", 400)
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise ApiError("video_asset_ids values must be non-empty strings", 400)
        validated[clean_video_name] = asset_id.strip()
    return validated


def required_payload_string(payload, key):
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{key} is required", 400)
    return value.strip()


def optional_payload_string(value, key):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{key} must be a non-empty string", 400)
    return value.strip()


def optional_payload_int(value, key, default, minimum=None, maximum=None):
    if value is None:
        return default
    if isinstance(value, bool):
        raise ApiError(f"{key} must be an integer", 400)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ApiError(f"{key} must be an integer", 400)
    if minimum is not None and parsed < minimum:
        raise ApiError(f"{key} must be at least {minimum}", 400)
    if maximum is not None and parsed > maximum:
        raise ApiError(f"{key} must be at most {maximum}", 400)
    return parsed


def clean_optional_string(value):
    if not isinstance(value, str):
        return None
    clean_value = value.strip()
    return clean_value or None


def read_json(path):
    return json.loads(path.read_text())
