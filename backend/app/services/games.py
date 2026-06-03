import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from copy import deepcopy
from pathlib import Path
from threading import Lock
from urllib.parse import quote

import requests

from app.core.config import (
    TWELVELABS_MODEL,
    TWELVELABS_PEGASUS_MODEL,
    default_game_registrations,
    env_default_game,
    knowledge_store_id as env_knowledge_store_id,
    twelvelabs_index_id,
)
from app.core.errors import ApiError
from app.integrations.twelvelabs import (
    add_indexed_asset as twelvelabs_add_indexed_asset,
    add_knowledge_store_item as twelvelabs_add_knowledge_store_item,
    analyze_video as twelvelabs_analyze_video,
    asset_duration_seconds as twelvelabs_asset_duration_seconds,
    asset_exists as twelvelabs_asset_exists,
    asset_is_playable as twelvelabs_asset_is_playable,
    create_response as twelvelabs_create_response,
    delete_indexed_asset,
    delete_knowledge_store_item,
    get_asset as twelvelabs_get_asset,
    get_indexed_asset as twelvelabs_get_indexed_asset,
    indexed_asset_asset_id,
    indexed_asset_display_name,
    indexed_asset_duration_seconds,
    indexed_asset_filename,
    indexed_asset_for_reference,
    indexed_asset_index_id,
    indexed_asset_status,
    indexed_asset_thumbnail_url,
    indexed_asset_user_metadata,
    indexed_asset_with_user_metadata,
    indexed_asset_workspace_video_name,
    list_asset_indexed_assets,
    list_indexed_assets,
    list_knowledge_store_items,
    parse_json_object,
    response_id,
    search_index as twelvelabs_search_index,
    update_indexed_asset_user_metadata,
    upload_asset_path,
)
from app.services.highlights import generate_highlight_reels, generate_pegasus_highlight_reels
from app.services.jockey_workspace_metadata import (
    find_saved_clip_analysis,
    jockey_entity_tracking_from_indexed_asset,
    jockey_entity_tracking_with_provenance,
    jockey_highlight_reels_from_indexed_asset,
    jockey_highlight_reels_with_provenance,
    load_cached_video_dashboard,
    parse_entity_tracking_summary_from_metadata,
    parse_highlight_reels_summary_from_metadata,
    parse_workspace_summary_from_metadata,
    store_jockey_entity_tracking,
    store_jockey_highlight_reels,
)


ROOT_DIR = Path(__file__).resolve().parents[2]
GAMES_DIR = ROOT_DIR / "data" / "games"
VIDEOS_DIR = ROOT_DIR / "data" / "videos"
THUMBNAILS_DIR = ROOT_DIR / "data" / "thumbnails"
REELS_DIR = ROOT_DIR / "data" / "reels"
LOGGER = logging.getLogger(__name__)
FFMPEG_PRESET = os.environ.get("SPORTS_FFMPEG_PRESET", "ultrafast")
REEL_CRF = int(os.environ.get("SPORTS_REEL_CRF", "23"))
ASSEMBLY_CRF = int(os.environ.get("SPORTS_ASSEMBLY_CRF", "24"))
ASSEMBLY_SEGMENT_WORKERS = max(1, int(os.environ.get("SPORTS_ASSEMBLY_SEGMENT_WORKERS", "4")))
ASSEMBLY_PARALLEL_MIN_SEGMENTS = max(2, int(os.environ.get("SPORTS_ASSEMBLY_PARALLEL_MIN_SEGMENTS", "3")))
FFMPEG_HLS_INPUT_ARGS = [
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
]
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
    "standard_stats": "score scoreboard official statistic result race status penalty card foul timeout substitution",
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
INDEX_VIDEOS_CACHE_TTL_SECONDS = int(os.environ.get("SPORTS_INDEX_VIDEOS_CACHE_TTL_SECONDS", "300"))
INDEX_VIDEOS_CACHE = {}
INDEX_VIDEOS_CACHE_LOCK = Lock()
INDEX_VIDEOS_BUILD_LOCKS = defaultdict(Lock)
PEGASUS_METADATA_CACHE_SCHEMA_VERSION = 4
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
                    "confidence": {"type": "number", "minimum": 0.01, "maximum": 1},
                    "highlight_potential": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": [
                    "video_reference",
                    "start_time",
                    "end_time",
                    "moment_type",
                    "emotional_intensity",
                    "jockey_rationale",
                    "confidence",
                    "highlight_potential",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["narrative_summary", "clips"],
    "additionalProperties": False,
}
SELECTED_CLIP_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "description": {"type": "string"},
        "emotional_tone": {"type": "string"},
        "key_action": {"type": "string"},
        "participants": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "role": {"type": "string"},
                    "team_or_group": {"type": "string"},
                    "evidence": {"type": "string"},
                },
                "required": ["name", "role", "team_or_group", "evidence"],
                "additionalProperties": False,
            },
        },
        "moment_types": {"type": "array", "items": {"type": "string"}},
        "tags": {"type": "array", "items": {"type": "string"}},
        "score_context": {"type": "string"},
        "visual_evidence": {"type": "array", "items": {"type": "string"}},
        "audio_evidence": {"type": "array", "items": {"type": "string"}},
        "transcript_evidence": {"type": "array", "items": {"type": "string"}},
        "producer_summary": {"type": "string"},
        "story_arc": {"type": "string"},
        "editorial_use": {"type": "string"},
        "recommended_formats": {"type": "array", "items": {"type": "string"}},
        "clip_boundary_notes": {"type": "string"},
        "rights_safety_notes": {"type": "string"},
        "confidence": {"type": "number"},
    },
    "required": [
        "description",
        "emotional_tone",
        "key_action",
        "participants",
        "moment_types",
        "tags",
        "score_context",
        "visual_evidence",
        "audio_evidence",
        "transcript_evidence",
        "producer_summary",
        "story_arc",
        "editorial_use",
        "recommended_formats",
        "clip_boundary_notes",
        "rights_safety_notes",
        "confidence",
    ],
    "additionalProperties": False,
}
ENTITY_TRACKING_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "entities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "entity_type": {"type": "string"},
                    "team_or_group": {"type": "string"},
                    "role": {"type": "string"},
                    "description": {"type": "string"},
                    "confidence": {"type": "number"},
                    "appearances": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "start_time": {"type": "string"},
                                "end_time": {"type": "string"},
                                "action": {"type": "string"},
                                "emotion": {"type": "string"},
                                "context": {"type": "string"},
                            },
                            "required": ["start_time", "end_time", "action", "emotion", "context"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["name", "entity_type", "team_or_group", "role", "description", "confidence", "appearances"],
                "additionalProperties": False,
            },
        },
        "relationships": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "entity": {"type": "string"},
                    "related_entity": {"type": "string"},
                    "timestamp": {"type": "string"},
                    "interaction_type": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["entity", "related_entity", "timestamp", "interaction_type", "description"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "entities", "relationships"],
    "additionalProperties": False,
}
GAME_DEBUG_FIELDS = {
    "jockey_metadata_cache",
    "marengo_index_id",
}


def hydrate_game_config(game):
    if not isinstance(game, dict):
        return game
    hydrated = deepcopy(game)
    if not clean_optional_string(hydrated.get("knowledge_store_id")):
        store_id = env_knowledge_store_id()
        if store_id:
            hydrated["knowledge_store_id"] = store_id
    if not clean_optional_string(hydrated.get("marengo_index_id")):
        index_id = twelvelabs_index_id()
        if index_id:
            hydrated["marengo_index_id"] = index_id
    return hydrated


def list_games():
    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    games_by_tag = {
        game["tag"]: hydrate_game_config(deepcopy(game))
        for game in default_game_registrations()
        if isinstance(game.get("tag"), str) and game["tag"]
    }
    for path in sorted(GAMES_DIR.glob("*.json")):
        game = hydrate_game_config(read_json(path))
        games_by_tag[game["tag"]] = game
    games = [public_game(game) for game in games_by_tag.values()]
    return {"games": games}


def list_game_index_videos(tag):
    get_game(tag)
    now = time.time()
    with INDEX_VIDEOS_CACHE_LOCK:
        cached = INDEX_VIDEOS_CACHE.get(tag)
        if cached and cached.get("expires_at", 0) > now:
            return dict(cached["payload"])

    with INDEX_VIDEOS_BUILD_LOCKS[tag]:
        with INDEX_VIDEOS_CACHE_LOCK:
            cached = INDEX_VIDEOS_CACHE.get(tag)
            if cached and cached.get("expires_at", 0) > now:
                return dict(cached["payload"])

        game = get_game(tag)
        index_id = configured_search_index_id(game)
        indexed_assets = list_indexed_assets(index_id)
        videos = [
            normalize_index_video(index_id, indexed_asset_with_user_metadata(index_id, indexed_asset))
            for indexed_asset in indexed_assets
        ]
        payload = {
            "index_id": index_id,
            "index_videos": [video for video in videos if video.get("id")],
        }
        if INDEX_VIDEOS_CACHE_TTL_SECONDS > 0:
            with INDEX_VIDEOS_CACHE_LOCK:
                INDEX_VIDEOS_CACHE[tag] = {
                    "expires_at": now + INDEX_VIDEOS_CACHE_TTL_SECONDS,
                    "payload": payload,
                }
        UPLOAD_BACKGROUND_EXECUTOR.submit(warm_missing_video_thumbnails, payload.get("index_videos", []))
        return payload


def invalidate_index_videos_cache(tag):
    with INDEX_VIDEOS_CACHE_LOCK:
        INDEX_VIDEOS_CACHE.pop(tag, None)


def list_game_discover_videos(tag):
    game = get_game(tag)
    index_payload = list_game_index_videos(tag)
    index_lookup = {}
    for video in index_payload.get("index_videos", []):
        if not isinstance(video, dict):
            continue
        for key in (
            clean_optional_string(video.get("source_video_name")),
            clean_optional_string(video.get("metadata_source_video_name")),
            clean_optional_string(video.get("name")),
            clean_optional_string(video.get("display_name")),
        ):
            if key:
                index_lookup.setdefault(key, video)

    discover_videos = []
    seen_names = set()
    source_order = {name: index for index, name in enumerate(game.get("source_videos", []))}
    for indexed in index_payload.get("index_videos", []):
        if not isinstance(indexed, dict):
            continue
        video_name = discover_video_name_for_indexed(game, indexed)
        if not video_name or video_name in seen_names:
            continue
        playback = discover_video_playback_status(game, tag, video_name, indexed)
        if not playback.get("discoverable"):
            continue
        discover_videos.append(build_discover_video_entry(game, tag, video_name, indexed, playback))
        seen_names.add(video_name)

    discover_videos.sort(key=lambda entry: source_order.get(entry["video_name"], 10_000))

    pending_videos = []
    for video_name in game.get("source_videos", []):
        if video_name in seen_names:
            continue
        indexed = index_lookup.get(video_name)
        playback = discover_video_playback_status(game, tag, video_name, indexed)
        if playback.get("stale_registration") or playback.get("repair_available"):
            pending_videos.append(build_discover_video_entry(game, tag, video_name, indexed, playback))

    UPLOAD_BACKGROUND_EXECUTOR.submit(warm_missing_game_thumbnails, tag, index_lookup)
    return {"videos": discover_videos, "pending_videos": pending_videos}


def discover_video_name_for_indexed(game, indexed):
    if not isinstance(indexed, dict):
        return None
    source_videos = set(game.get("source_videos", []))
    for key in (
        clean_optional_string(indexed.get("metadata_source_video_name")),
        clean_optional_string(indexed.get("source_video_name")),
        clean_optional_string(indexed.get("name")),
        clean_optional_string(indexed.get("display_name")),
        clean_optional_string(indexed.get("indexed_asset_id")),
        clean_optional_string(indexed.get("asset_id")),
    ):
        if not key:
            continue
        resolved = video_name_for_reference(game, key)
        if resolved and resolved in source_videos:
            return resolved
        if key in source_videos:
            return key
    return None


def build_discover_video_entry(game, tag, video_name, indexed, playback):
    thumbnail_url = playback.get("thumbnail_url")
    local_thumbnail = registered_thumbnail_path_or_none(tag, video_name)
    return {
        "video_name": video_name,
        "thumbnail_url": thumbnail_url,
        "thumbnail_path": (
            None
            if thumbnail_url
            else f"/games/{tag}/thumbnail/{quote(video_name, safe='')}"
        ),
        "stream_info_path": f"/games/{tag}/stream/{quote(video_name, safe='')}",
        "indexed": bool(indexed),
        "in_live_index": bool(indexed),
        "playback_ready": playback.get("playback_ready", False),
        "discoverable": playback.get("discoverable", False),
        "stale_registration": playback.get("stale_registration", False),
        "repair_available": playback.get("repair_available", False),
        "status": playback.get("status") or (clean_optional_string(indexed.get("status")) if indexed else "registered"),
        "has_local_thumbnail": bool(local_thumbnail),
        "indexed_asset_id": playback.get("indexed_asset_id"),
        "asset_id": playback.get("asset_id"),
    }


def discover_video_playback_status(game, tag, video_name, indexed=None):
    indexed = indexed if isinstance(indexed, dict) else {}
    registered_asset_id = asset_id_for_video_name(game, video_name)
    indexed_asset_id = clean_optional_string(indexed.get("indexed_asset_id"))
    indexed_asset = clean_optional_string(indexed.get("asset_id"))
    thumbnail_url = clean_optional_string(indexed.get("thumbnail_url"))
    status = clean_optional_string(indexed.get("status")) or "registered"
    local_video = video_path(video_name)

    if indexed:
        playback_ready = status == "ready" and bool(indexed_asset)
        return {
            "playback_ready": playback_ready,
            "discoverable": playback_ready,
            "stale_registration": False,
            "repair_available": False,
            "thumbnail_url": thumbnail_url,
            "asset_id": indexed_asset or registered_asset_id,
            "indexed_asset_id": indexed_asset_id,
            "status": status,
        }

    stale_registration = bool(registered_asset_id or marengo_video_id_for_video_name(game, video_name))
    if registered_asset_id:
        stale_registration = not twelvelabs_asset_is_playable(registered_asset_id)
    elif video_name in game.get("source_videos", []) and local_video.exists():
        stale_registration = True
    return {
        "playback_ready": False,
        "discoverable": False,
        "stale_registration": stale_registration,
        "repair_available": stale_registration and local_video.exists(),
        "thumbnail_url": None,
        "asset_id": registered_asset_id,
        "indexed_asset_id": marengo_video_id_for_video_name(game, video_name),
        "status": "not_indexed" if stale_registration and not registered_asset_id else ("stale" if stale_registration else "registered"),
    }


def queue_game_video_repair(tag, video_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    if not video_path(video_name).exists():
        raise ApiError(f"Local video file not found for {video_name}", 404)
    UPLOAD_BACKGROUND_EXECUTOR.submit(_run_video_repair, tag, video_name)
    return {
        "status": "repairing",
        "video_name": video_name,
        "message": "Re-uploading the local video to TwelveLabs and refreshing the index.",
    }


def _run_video_repair(tag, video_name):
    try:
        repair_game_video(tag, video_name)
    except Exception as exc:
        print(f"[repair] failed for {video_name}: {exc}", flush=True)


def cleanup_remote_video_bindings(game, video_name):
    knowledge_store_id = clean_optional_string(game.get("knowledge_store_id"))
    search_index_id = clean_optional_string(game.get("marengo_index_id"))
    video_reference_map = game.get("video_reference_map", {}) if isinstance(game.get("video_reference_map"), dict) else {}
    asset_id = clean_optional_string(game.get("video_asset_ids", {}).get(video_name))
    indexed_asset_id = clean_optional_string(game.get("marengo_video_ids", {}).get(video_name))

    knowledge_item_ids = set()
    for key, value in video_reference_map.items():
        if value != video_name:
            continue
        key = clean_optional_string(key)
        if key and key.startswith("ksi_"):
            knowledge_item_ids.add(key)

    if knowledge_store_id and asset_id:
        for item in list_knowledge_store_items(knowledge_store_id):
            if not isinstance(item, dict):
                continue
            item_asset_id = clean_optional_string(item.get("asset_id"))
            item_id = clean_optional_string(item.get("_id") or item.get("id"))
            if item_asset_id == asset_id and item_id:
                knowledge_item_ids.add(item_id)

    for item_id in knowledge_item_ids:
        delete_knowledge_store_item(knowledge_store_id, item_id)

    if search_index_id and indexed_asset_id:
        delete_indexed_asset(search_index_id, indexed_asset_id)


def clear_stale_video_bindings(tag, video_name):
    with UPLOAD_METADATA_LOCK:
        game = get_game(tag)
        cleanup_remote_video_bindings(game, video_name)
        video_reference_map = deepcopy(game.get("video_reference_map", {})) if isinstance(game.get("video_reference_map"), dict) else {}
        video_asset_ids = deepcopy(game.get("video_asset_ids", {})) if isinstance(game.get("video_asset_ids"), dict) else {}
        marengo_video_ids = deepcopy(game.get("marengo_video_ids", {})) if isinstance(game.get("marengo_video_ids"), dict) else {}

        video_asset_ids.pop(video_name, None)
        marengo_video_ids.pop(video_name, None)
        pruned_reference_map = {
            key: value
            for key, value in video_reference_map.items()
            if value != video_name or key == video_name
        }

        register_game(
            {
                "tag": game["tag"],
                "label": game["label"],
                "sport": game["sport"],
                "knowledge_store_id": configured_knowledge_store_id(game),
                "source_videos": game.get("source_videos", []),
                "video_reference_map": pruned_reference_map,
                "video_asset_ids": video_asset_ids,
                "marengo_index_id": game.get("marengo_index_id"),
                "marengo_video_ids": marengo_video_ids,
            }
        )


def repair_game_video(tag, video_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    path = video_path(video_name)
    if not path.exists():
        raise ApiError(f"Local video file not found for {video_name}", 404)

    clear_stale_video_bindings(tag, video_name)
    game = get_game(tag)
    search_index_id, created_index = ensure_game_search_index(game)
    uploaded_asset = upload_asset_path(path)
    asset_id = response_id(uploaded_asset)
    if not asset_id:
        raise ApiError("TwelveLabs upload response did not include an asset id", 502)

    wait_for_uploaded_asset_ready(asset_id, uploaded_asset)
    knowledge_store_item = add_game_video_to_knowledge_store(game["knowledge_store_id"], asset_id)
    indexed_asset = add_game_video_to_search_index(search_index_id, asset_id)
    updated_game = update_uploaded_game_metadata(
        tag=tag,
        video_name=video_name,
        asset_id=asset_id,
        search_index_id=search_index_id,
        knowledge_store_item=knowledge_store_item,
        indexed_asset=indexed_asset,
    )
    cache_indexed_video_thumbnail(video_name, indexed_asset, search_index_id)
    with INDEX_VIDEOS_CACHE_LOCK:
        INDEX_VIDEOS_CACHE.pop(tag, None)
    with STREAM_INFO_CACHE_LOCK:
        for cache_key in [key for key in STREAM_INFO_CACHE if key[0] == tag]:
            STREAM_INFO_CACHE.pop(cache_key, None)

    playback = discover_video_playback_status(updated_game, tag, video_name, normalize_index_video(
        search_index_id,
        indexed_asset_with_user_metadata(search_index_id, indexed_asset),
    ))
    return {
        "status": "ready",
        "video_name": video_name,
        "asset_id": asset_id,
        "indexed_asset_id": response_id(indexed_asset),
        "created_search_index": bool(created_index),
        "playback_ready": playback.get("playback_ready", False),
        "thumbnail_url": playback.get("thumbnail_url"),
        "game": public_game(updated_game),
    }


def warm_missing_game_thumbnails(tag, indexed_lookup):
    game = get_game(tag)
    indexed_names = set(indexed_lookup.keys())
    for video_name in game.get("source_videos", []):
        if video_name in indexed_names or registered_thumbnail_path_or_none(tag, video_name):
            continue
        remote_url = registered_indexed_thumbnail_url(tag, video_name)
        if remote_url:
            persist_remote_thumbnail(video_name, remote_url)


def warm_missing_video_thumbnails(index_videos):
    for video in index_videos:
        if not isinstance(video, dict):
            continue
        source_name = clean_optional_string(video.get("source_video_name")) or clean_optional_string(video.get("name"))
        thumbnail_url = clean_optional_string(video.get("thumbnail_url"))
        if source_name and thumbnail_url:
            persist_remote_thumbnail(source_name, thumbnail_url)


def get_game(tag):
    path = game_path(tag)
    if path.exists():
        return hydrate_game_config(read_json(path))
    for game in default_game_registrations():
        if game.get("tag") == tag:
            return hydrate_game_config(deepcopy(game))
    env_game = env_default_game()
    if env_game and env_game.get("tag") == tag:
        return hydrate_game_config(env_game)
    raise ApiError("game not found", 404)


def configured_knowledge_store_id(game=None):
    if isinstance(game, dict):
        store_id = clean_optional_string(game.get("knowledge_store_id"))
        if store_id:
            return store_id
    store_id = env_knowledge_store_id()
    if store_id:
        return store_id
    raise ApiError("KNOWLEDGE_STORE_ID or game knowledge_store_id is required for Jockey", 500)


def public_game(game):
    return {key: value for key, value in game.items() if key not in GAME_DEBUG_FIELDS}


def register_game(payload):
    tag = required_payload_string(payload, "tag")
    if not TAG_PATTERN.match(tag):
        raise ApiError("tag must be lowercase letters, numbers, and hyphens", 400)

    path = game_path(tag)
    existing_game = read_json(path) if path.exists() else {}
    remote_asset_ids = payload.get("video_asset_ids", existing_game.get("video_asset_ids", {}))
    source_videos = validate_source_videos(payload.get("source_videos", []), remote_asset_ids=remote_asset_ids)
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
    with INDEX_VIDEOS_CACHE_LOCK:
        INDEX_VIDEOS_CACHE.pop(tag, None)
    with STREAM_INFO_CACHE_LOCK:
        for cache_key in [key for key in STREAM_INFO_CACHE if key[0] == tag]:
            STREAM_INFO_CACHE.pop(cache_key, None)
    return game


def upload_game_video(tag, uploaded_file):
    game = get_game(tag)
    search_index_id, created_index = ensure_game_search_index(game)
    requested_video_name = safe_uploaded_video_name(uploaded_file.filename)
    video_name = unique_uploaded_video_name(requested_video_name)
    upload_aliases = unique_preserving_order(
        [alias for alias in (requested_video_name, Path(requested_video_name).name) if alias and alias != video_name]
    )
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
        upload_aliases=upload_aliases,
    )
    remove_local_video_file(video_name)
    queue_uploaded_video_indexing(
        tag=tag,
        video_name=video_name,
        asset_id=asset_id,
        uploaded_asset=uploaded_asset,
        search_index_id=search_index_id,
        upload_aliases=upload_aliases,
    )
    return {
        "status": "indexing",
        "video_name": video_name,
        "asset_id": asset_id,
        "asset": uploaded_asset,
        "knowledge_store_id": configured_knowledge_store_id(game),
        "index_configured": True,
        "created_search_index": bool(created_index),
        "message": "Upload accepted. The index and knowledge-base item will be ready in a few minutes.",
        "game": public_game(updated_game),
    }


def queue_uploaded_video_indexing(tag, video_name, asset_id, uploaded_asset, search_index_id, upload_aliases=None):
    UPLOAD_BACKGROUND_EXECUTOR.submit(
        finish_uploaded_video_indexing,
        tag,
        video_name,
        asset_id,
        uploaded_asset,
        search_index_id,
        upload_aliases or [],
    )


def finish_uploaded_video_indexing(tag, video_name, asset_id, uploaded_asset, search_index_id, upload_aliases=None):
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
            upload_aliases=upload_aliases,
        )
        cache_indexed_video_thumbnail(video_name, indexed_asset, search_index_id)
        remove_local_video_file(video_name)
    except Exception:
        LOGGER.exception("Failed to finish upload indexing for %s (%s)", video_name, asset_id)


def update_uploaded_game_metadata(
    tag,
    video_name,
    asset_id,
    search_index_id,
    knowledge_store_item=None,
    indexed_asset=None,
    upload_aliases=None,
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
                upload_aliases=upload_aliases,
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


def remove_local_video_file(video_name):
    if not isinstance(video_name, str) or not video_name.strip():
        return False
    try:
        path = video_path(video_name.strip())
    except ApiError:
        return False
    try:
        if path.exists() or path.is_symlink():
            path.unlink()
            return True
    except OSError as exc:
        LOGGER.warning("failed to remove local video %s: %s", path, exc)
    return False


def remove_local_video_files(video_names):
    removed = []
    for video_name in video_names or []:
        if remove_local_video_file(video_name):
            removed.append(video_name)
    return removed


def wait_for_uploaded_asset_ready(asset_id, uploaded_asset):
    current_asset = uploaded_asset if isinstance(uploaded_asset, dict) else {}
    if clean_optional_string(current_asset.get("status")) == "ready":
        return current_asset

    for attempt in range(1, max(1, UPLOAD_ASSET_READY_POLL_ATTEMPTS) + 1):
        if attempt > 1 and UPLOAD_ASSET_READY_POLL_INTERVAL_SECONDS:
            time.sleep(UPLOAD_ASSET_READY_POLL_INTERVAL_SECONDS)
        current_asset = twelvelabs_get_asset(asset_id)
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
    return twelvelabs_add_knowledge_store_item(knowledge_store_id, asset_id)


def add_game_video_to_search_index(search_index_id, asset_id):
    return twelvelabs_add_indexed_asset(search_index_id, asset_id)


def uploaded_game_payload(
    game,
    video_name,
    asset_id,
    search_index_id,
    knowledge_store_item,
    indexed_asset,
    upload_aliases=None,
):
    source_videos = unique_preserving_order([*game.get("source_videos", []), video_name])
    video_reference_map = deepcopy(game.get("video_reference_map", {})) if isinstance(game.get("video_reference_map"), dict) else {}
    video_asset_ids = deepcopy(game.get("video_asset_ids", {})) if isinstance(game.get("video_asset_ids"), dict) else {}
    search_video_ids = deepcopy(game.get("marengo_video_ids", {})) if isinstance(game.get("marengo_video_ids"), dict) else {}

    video_asset_ids[video_name] = asset_id
    indexed_asset_id = response_id(indexed_asset)
    knowledge_store_item_id = response_id(knowledge_store_item)
    if indexed_asset_id:
        search_video_ids[video_name] = indexed_asset_id

    references = [video_name, asset_id, indexed_asset_id, knowledge_store_item_id, *(upload_aliases or [])]
    if isinstance(indexed_asset, dict):
        references.extend(
            [
                indexed_asset_filename(indexed_asset),
                indexed_asset_display_name(indexed_asset),
            ]
        )
    for reference in references:
        if reference:
            video_reference_map[reference] = video_name
    if knowledge_store_item_id and knowledge_store_item_id.startswith("ksi_"):
        video_reference_map[knowledge_store_item_id.removeprefix("ksi_")] = video_name

    payload = {
        "tag": game["tag"],
        "label": game["label"],
        "sport": game["sport"],
        "knowledge_store_id": configured_knowledge_store_id(game),
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
    asset = twelvelabs_get_asset(asset_id)
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
    asset = twelvelabs_get_asset(asset_id)
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
    force_generate = bool(payload.get("force_generate") or payload.get("regenerate"))
    include_entity_tracking = bool(payload.get("include_entity_tracking"))
    requested_video = payload.get("indexed_asset_id") or payload.get("asset_id") or payload.get("video_name") or payload.get("source_video")
    requested_source_video = payload.get("video_name") or payload.get("source_video")
    video_target = None
    index_id = configured_search_index_id(game)
    if requested_video:
        video_target = resolve_workspace_video_target(
            game,
            video_name=requested_source_video,
            indexed_asset_id=payload.get("indexed_asset_id"),
            asset_id=payload.get("asset_id"),
            reference=requested_video,
            lookup=payload,
        )
    video_name = video_target["video_name"] if video_target else None

    match_context = payload.get("match_context") or scoped_match_context(game, video_name)
    wsc_baseline = payload.get("wsc_baseline", game.get("wsc_baseline"))

    if video_name and not force_generate:
        bundle = load_cached_video_dashboard(game, video_name, lookup=payload)
        if bundle and bundle.get("highlight_reels"):
            cached = bundle["highlight_reels"]
            highlight_reels = jockey_highlight_reels_with_provenance(
                cached["reels"],
                user_metadata=cached["metadata"],
                index_id=bundle["index_id"],
                indexed_asset_id=bundle["indexed_asset_id"],
                asset_id=bundle["asset_id"],
                video_name=video_name,
                source="indexed_asset_user_metadata",
            )
            if not include_entity_tracking:
                return highlight_reels

            entity_tracking = None
            cached_entity = bundle.get("entity_tracking")
            if cached_entity:
                entity_tracking = jockey_entity_tracking_with_provenance(
                    cached_entity["tracking"],
                    user_metadata=cached_entity["metadata"],
                    index_id=bundle["index_id"],
                    indexed_asset_id=bundle["indexed_asset_id"],
                    asset_id=bundle["asset_id"],
                    video_name=video_name,
                    source="indexed_asset_user_metadata",
                )
            else:
                entity_tracking = create_entity_tracking_response(
                    tag,
                    {
                        **payload,
                        "video_name": video_name,
                        "include_entity_tracking": False,
                    },
                )

            return {
                "video_name": video_name,
                "highlight_reels": highlight_reels,
                "entity_tracking": entity_tracking,
            }

        asset_id = video_target["asset_id"] if video_target else asset_id_for_video_name(game, video_name)
        if asset_id:
            indexed_assets = indexed_assets_for_video_metadata(game, index_id, asset_id, video_name)
            for indexed_asset in indexed_assets:
                cached = jockey_highlight_reels_from_indexed_asset(indexed_asset, video_name, asset_id)
                if not cached:
                    continue
                indexed_asset_id = response_id(indexed_asset)
                highlight_reels = jockey_highlight_reels_with_provenance(
                    cached["reels"],
                    user_metadata=cached["metadata"],
                    index_id=index_id,
                    indexed_asset_id=indexed_asset_id,
                    asset_id=asset_id,
                    video_name=video_name,
                    source="indexed_asset_user_metadata",
                )
                if not include_entity_tracking:
                    return highlight_reels
                entity_tracking = create_entity_tracking_response(
                    tag,
                    {
                        **payload,
                        "video_name": video_name,
                        "include_entity_tracking": False,
                    },
                )
                return {
                    "video_name": video_name,
                    "highlight_reels": highlight_reels,
                    "entity_tracking": entity_tracking,
                }

    reels = generate_highlight_reels(
        configured_knowledge_store_id(game),
        match_context=match_context,
        wsc_baseline=wsc_baseline,
    )

    highlight_reels = None
    if video_name:
        asset_id = video_target["asset_id"] if video_target else asset_id_for_video_name(game, video_name)
        if asset_id:
            indexed_assets = indexed_assets_for_video_metadata(game, index_id, asset_id, video_name)
            indexed_asset = indexed_asset_for_generated_metadata(game, index_id, asset_id, video_name, indexed_assets)
            indexed_asset_id = response_id(indexed_asset)
            if indexed_asset_id:
                user_metadata = store_jockey_highlight_reels(
                    index_id,
                    indexed_asset_id,
                    asset_id,
                    video_name,
                    reels,
                    match_context=match_context,
                    wsc_baseline=wsc_baseline,
                )
                invalidate_index_videos_cache(tag)
                merged_metadata = indexed_asset_user_metadata(indexed_asset)
                if isinstance(user_metadata, dict):
                    merged_metadata = {**merged_metadata, **user_metadata}
                highlight_reels = jockey_highlight_reels_with_provenance(
                    reels,
                    user_metadata=merged_metadata,
                    index_id=index_id,
                    indexed_asset_id=indexed_asset_id,
                    asset_id=asset_id,
                    video_name=video_name,
                    source="generated_and_stored_to_user_metadata",
                )

    if not highlight_reels:
        highlight_reels = jockey_highlight_reels_with_provenance(
            reels,
            video_name=video_name,
            source="jockey_knowledge_store",
        )

    if not include_entity_tracking or not video_name:
        return highlight_reels

    entity_tracking = create_entity_tracking_response(
        tag,
        {
            **payload,
            "video_name": video_name,
            "include_entity_tracking": False,
        },
    )
    return {
        "video_name": video_name,
        "highlight_reels": highlight_reels,
        "entity_tracking": entity_tracking,
    }


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
    detailed_response = parse_json_object(metadata.get(PEGASUS_DETAILED_RESPONSE_METADATA_FIELD))
    if detailed_response.get("schema_version") != PEGASUS_METADATA_CACHE_SCHEMA_VERSION:
        return None
    if strict and metadata.get(PEGASUS_REELS_ASSET_ID_METADATA_FIELD) != asset_id:
        return None
    if strict and metadata.get(PEGASUS_REELS_HASH_METADATA_FIELD) != context_hash:
        return None
    metadata_model = metadata.get(PEGASUS_REELS_MODEL_METADATA_FIELD)
    if metadata_model and metadata_model != TWELVELABS_PEGASUS_MODEL:
        return None
    raw_reels = metadata.get(PEGASUS_REELS_METADATA_FIELD)
    if not isinstance(raw_reels, str) or not raw_reels.strip():
        reels = detailed_response.get("response") if isinstance(detailed_response.get("response"), dict) else None
        return reels if is_complete_highlight_reels(reels) else None
    try:
        reels = json.loads(raw_reels)
    except json.JSONDecodeError:
        reels = detailed_response.get("response") if isinstance(detailed_response.get("response"), dict) else None
        return reels if is_complete_highlight_reels(reels) else None
    return reels if is_complete_highlight_reels(reels) else None


def store_pegasus_reels_index_metadata(index_id, indexed_asset_id, asset_id, context_hash, reels, video_name=None):
    if not is_complete_highlight_reels(reels):
        return {}
    user_metadata = pegasus_reels_index_user_metadata(index_id, indexed_asset_id, asset_id, context_hash, reels, video_name)
    update_indexed_asset_user_metadata(index_id, indexed_asset_id, user_metadata)
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
        indexed_asset = twelvelabs_get_indexed_asset(index_id, indexed_asset_id)
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
                indexed_asset = twelvelabs_get_indexed_asset(index_id, indexed_asset_id)
            except ApiError:
                pass
        candidates.append(indexed_asset)

    for indexed_asset in list_asset_indexed_assets(asset_id):
        if indexed_asset_index_id(indexed_asset) == index_id:
            add_candidate(indexed_asset)

    indexed_asset_id = marengo_video_id_for_video_name(game, video_name)
    if indexed_asset_id:
        try:
            add_candidate(twelvelabs_get_indexed_asset(index_id, indexed_asset_id))
        except ApiError:
            pass

    for indexed_asset in list_indexed_assets(index_id):
        if indexed_asset_matches_video(game, indexed_asset, asset_id, video_name):
            add_candidate(indexed_asset)

    return candidates


def normalize_index_video(index_id, indexed_asset):
    indexed_asset_id = response_id(indexed_asset)
    asset_id = indexed_asset_asset_id(indexed_asset)
    filename = indexed_asset_filename(indexed_asset)
    metadata = indexed_asset_user_metadata(indexed_asset)
    detailed_response = parse_json_object(metadata.get(PEGASUS_DETAILED_RESPONSE_METADATA_FIELD))
    clip_counts = detailed_response.get("clip_counts") if isinstance(detailed_response.get("clip_counts"), dict) else None
    metadata_source = clean_optional_string(metadata.get(PEGASUS_REELS_SOURCE_VIDEO_METADATA_FIELD))
    workspace_summary = parse_workspace_summary_from_metadata(metadata)
    workspace_counts = workspace_summary.get("counts") if isinstance(workspace_summary, dict) else None
    highlight_summary = parse_highlight_reels_summary_from_metadata(metadata)
    highlight_clip_counts = highlight_summary.get("clip_counts") if isinstance(highlight_summary, dict) else None
    entity_tracking_summary = parse_entity_tracking_summary_from_metadata(metadata)
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
        "has_jockey_highlight_metadata": bool(highlight_summary),
        "jockey_highlight_generated_at": clean_optional_string(highlight_summary.get("generated_at")) if highlight_summary else None,
        "jockey_highlight_clip_counts": highlight_clip_counts,
        "has_jockey_entity_tracking_metadata": bool(entity_tracking_summary),
        "jockey_entity_tracking_generated_at": clean_optional_string(entity_tracking_summary.get("generated_at")) if entity_tracking_summary else None,
        "jockey_entity_tracking_entity_count": entity_tracking_summary.get("entity_count") if entity_tracking_summary else None,
        "has_jockey_workspace_metadata": bool(workspace_summary),
        "jockey_workspace_updated_at": clean_optional_string(workspace_summary.get("updated_at")) if workspace_summary else None,
        "jockey_workspace_counts": workspace_counts,
        "metadata_generated_at": clean_optional_string(metadata.get(PEGASUS_REELS_GENERATED_AT_METADATA_FIELD)),
        "metadata_source_video_name": metadata_source,
        "metadata_clip_counts": clip_counts,
    }


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


def indexed_asset_id_for_asset(game, index_id, asset_id, video_name=None):
    for indexed_asset in list_asset_indexed_assets(asset_id):
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
    video_name = None
    if requested_video or payload.get("indexed_asset_id") or payload.get("asset_id"):
        video_name = resolve_workspace_video_target(
            game,
            video_name=requested_video,
            indexed_asset_id=payload.get("indexed_asset_id"),
            asset_id=payload.get("asset_id"),
            lookup=payload,
        )["video_name"]
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

    result = twelvelabs_search_index(fields)
    return normalize_marengo_search(game, query, result, limit, search_options, group_by)


def create_selected_clip_analysis(tag, payload=None):
    game = get_game(tag)
    payload = payload or {}
    force_generate = bool(payload.get("force_generate") or payload.get("regenerate"))
    requested_video_name = required_payload_string(payload, "video_name")
    video_reference = clean_optional_string(payload.get("video_reference"))
    video_name = (
        video_name_for_reference(game, requested_video_name)
        or video_name_for_reference(game, video_reference)
        or requested_video_name
    )
    try:
        video_name = resolve_workspace_video_target(
            game,
            video_name=video_name,
            indexed_asset_id=payload.get("indexed_asset_id"),
            asset_id=payload.get("asset_id") or payload.get("source_asset_id"),
            reference=video_reference,
            lookup=payload,
        )["video_name"]
    except ApiError:
        pass
    start_time = required_payload_string(payload, "start_time")
    start_seconds = seconds_from_timecode(start_time)
    if start_seconds is None:
        raise ApiError("start_time must be a timecode like M:SS or H:MM:SS", 400)
    end_time = clean_optional_string(payload.get("end_time")) or timecode_from_seconds(start_seconds + 12)
    end_seconds = seconds_from_timecode(end_time)
    if end_seconds is None or end_seconds <= start_seconds:
        end_seconds = start_seconds + 12
        end_time = timecode_from_seconds(end_seconds)

    query = clean_optional_string(payload.get("query"))
    title = clean_optional_string(payload.get("title"))

    if not force_generate:
        cached = find_saved_clip_analysis(
            tag,
            video_name,
            start_time,
            end_time,
            query=query or title,
            lookup=payload,
        )
        if cached and isinstance(cached.get("analysis"), dict):
            cached_item = cached.get("item") if isinstance(cached.get("item"), dict) else {}
            return selected_clip_analysis_with_provenance(
                cached["analysis"],
                source="indexed_asset_user_metadata",
                from_user_metadata=True,
                saved_at=clean_optional_string(cached_item.get("saved_at")),
                stored_to_user_metadata=True,
                duplicate=True,
                workspace_item_id=clean_optional_string(cached_item.get("id")),
            )

    clip_padding_before = 2
    clip_padding_after = 4
    analyze_start = max(0, start_seconds - clip_padding_before)
    analyze_end = end_seconds + clip_padding_after
    asset_id = asset_id_for_selected_clip_analysis(game, video_name, video_reference, payload)
    if not asset_id:
        raise ApiError(
            {
                "message": "Selected clip analysis requires a TwelveLabs asset id from the Marengo result",
                "video_name": video_name,
                "video_reference": video_reference,
            },
            404,
        )
    prompt = selected_clip_analysis_prompt(
        game=game,
        video_name=video_name,
        video_reference=video_reference,
        start_time=start_time,
        end_time=end_time,
        query=query,
        marengo_description=clean_optional_string(payload.get("description")),
        marengo_relevance=clean_optional_string(payload.get("relevance")),
    )
    result = twelvelabs_analyze_video(
        {
            "model_name": TWELVELABS_PEGASUS_MODEL,
            "video": {
                "type": "asset_id",
                "asset_id": asset_id,
            },
            "start_time": float(analyze_start),
            "end_time": float(analyze_end),
            "prompt": prompt,
            "temperature": 0.2,
            "response_format": {
                "type": "json_schema",
                "json_schema": SELECTED_CLIP_ANALYSIS_SCHEMA,
            },
            "max_tokens": 3200,
        },
    )
    analysis = parse_selected_clip_analysis_json(result)
    normalized = normalize_selected_clip_analysis(
        game=game,
        video_name=video_name,
        start_time=start_time,
        end_time=end_time,
        asset_id=asset_id,
        video_reference=video_reference,
        analyze_start=analyze_start,
        analyze_end=analyze_end,
        result=result,
        analysis=analysis,
    )

    return selected_clip_analysis_with_provenance(
        normalized,
        source="pegasus_clip_analysis",
        from_user_metadata=False,
    )


def selected_clip_analysis_with_provenance(
    analysis,
    *,
    source,
    from_user_metadata=False,
    saved_at=None,
    stored_to_user_metadata=False,
    duplicate=False,
    workspace_item_id=None,
):
    if not isinstance(analysis, dict):
        raise ApiError("Selected clip analysis payload was not an object", 502)
    response = dict(analysis)
    response["_jockey_metadata"] = {
        "source": source,
        "from_user_metadata": from_user_metadata,
        "saved_at": saved_at,
        "stored_to_user_metadata": stored_to_user_metadata,
        "duplicate": duplicate,
        "workspace_item_id": workspace_item_id,
    }
    return response


def asset_id_for_selected_clip_analysis(game, video_name, video_reference, payload):
    for key in ("asset_id", "source_asset_id"):
        asset_id = clean_optional_string(payload.get(key))
        if asset_id:
            return asset_id

    mapped_asset_id = asset_id_for_video_name(game, video_name)
    if mapped_asset_id:
        return mapped_asset_id

    index_id = configured_search_index_id(game)
    if not index_id:
        return None
    references = [
        video_reference,
        payload.get("indexed_asset_id"),
        payload.get("indexed_assetId"),
        payload.get("video_reference"),
        payload.get("video_name"),
    ]
    for reference in references:
        clean_reference = clean_optional_string(reference)
        if not clean_reference:
            continue
        indexed_asset = indexed_asset_for_reference(index_id, clean_reference)
        if indexed_asset:
            asset_id = indexed_asset_asset_id(indexed_asset)
            if asset_id:
                return asset_id
    return None


def selected_clip_analysis_prompt(
    game,
    video_name,
    start_time,
    end_time,
    query=None,
    marengo_description=None,
    marengo_relevance=None,
    video_reference=None,
):
    parts = [
        "Analyze this single Marengo-retrieved sports clip with Pegasus 1.5.",
        "Return JSON only using the provided schema.",
        f"Game context: {game['label']} ({game['sport']}).",
        f"Source video: {video_name}.",
        f"Selected playable clip range: {start_time} - {end_time}.",
        "Focus on the selected clip. Use nearby padded context only to understand the moment boundaries.",
        "Generate producer-ready structured metadata: description, emotional_tone, key_action, participants, moment_types, tags, score_context, producer_summary, story_arc, editorial_use, recommended_formats, clip_boundary_notes, rights_safety_notes, evidence lists, and confidence.",
        "participants should include named people, teams, crowd groups, officials, bench, or coaches only when supported; otherwise use grounded generic labels such as home crowd, teammates, coaching staff, or broadcast booth.",
        "recommended_formats should describe useful edit surfaces such as 9:16 social reel, 16:9 recap, 1:1 feed cut, cold-open, reaction insert, or thumbnail candidate.",
        "rights_safety_notes should flag visible broadcast graphics, scoreboard/OCR, crowd closeups, sponsor marks, or anything a producer should review before publishing.",
        "Do not invent players, scores, emotions, audio, transcript, or visual details. Use empty arrays for unsupported evidence lists.",
    ]
    if video_reference and video_reference != video_name:
        parts.append(f"Marengo indexed video reference: {video_reference}.")
    if query:
        parts.append(f"Original Marengo search query: {query}.")
    if marengo_description:
        parts.append(f"Marengo retrieved description: {marengo_description}.")
    if marengo_relevance:
        parts.append(f"Marengo retrieval rationale: {marengo_relevance}.")
    return "\n".join(parts)


def parse_selected_clip_analysis_json(result):
    if isinstance(result, dict):
        if all(key in result for key in SELECTED_CLIP_ANALYSIS_SCHEMA["required"]):
            return result
        nested_result = result.get("result")
        if isinstance(nested_result, dict):
            try:
                return parse_selected_clip_analysis_json(nested_result)
            except ApiError:
                pass
        for candidate in selected_clip_analysis_text_candidates(result):
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
    raise ApiError("Pegasus 1.5 selected clip analysis did not include valid JSON", 502)


def selected_clip_analysis_text_candidates(result):
    candidates = []
    for key in ("data", "text", "response", "output_text"):
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip())
            event_text = event_stream_text(value)
            if event_text:
                candidates.append(event_text)
    output = result.get("output")
    if isinstance(output, str) and output.strip():
        candidates.append(output.strip())
    elif isinstance(output, list):
        for item in output:
            if isinstance(item, str) and item.strip():
                candidates.append(item.strip())
            elif isinstance(item, dict):
                for key in ("data", "text", "content"):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        candidates.append(value.strip())
    return candidates


def event_stream_text(value):
    chunks = []
    for line in value.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        text = event.get("text") if isinstance(event, dict) else None
        if isinstance(text, str):
            chunks.append(text)
    return "".join(chunks).strip()


def normalize_selected_clip_analysis(game, video_name, start_time, end_time, asset_id, video_reference, analyze_start, analyze_end, result, analysis):
    if not isinstance(analysis, dict):
        raise ApiError("Pegasus 1.5 selected clip analysis response was not an object", 502)
    confidence = analysis.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = 0.75
    confidence = min(1, max(0.01, float(confidence)))
    return {
        "provider": "twelvelabs",
        "model": TWELVELABS_PEGASUS_MODEL,
        "source": "pegasus_clip_analysis",
        "response_id": response_id(result),
        "game_tag": game["tag"],
        "video_name": video_name,
        "video_reference": video_reference or video_name,
        "asset_id": asset_id,
        "start_time": start_time,
        "end_time": end_time,
        "analyze_window": {
            "start_time": timecode_from_seconds(analyze_start),
            "end_time": timecode_from_seconds(analyze_end),
        },
        "description": clean_optional_string(analysis.get("description")) or "Pegasus analyzed the selected clip.",
        "emotional_tone": clean_optional_string(analysis.get("emotional_tone")) or "Not clearly supported",
        "key_action": clean_optional_string(analysis.get("key_action")) or "No key action was clearly returned.",
        "participants": normalize_participants(analysis.get("participants")),
        "moment_types": normalize_analysis_list(analysis.get("moment_types")),
        "tags": normalize_analysis_list(analysis.get("tags")),
        "score_context": clean_optional_string(analysis.get("score_context")) or "No score context was clearly supported.",
        "visual_evidence": normalize_analysis_list(analysis.get("visual_evidence")),
        "audio_evidence": normalize_analysis_list(analysis.get("audio_evidence")),
        "transcript_evidence": normalize_analysis_list(analysis.get("transcript_evidence")),
        "producer_summary": clean_optional_string(analysis.get("producer_summary")) or "No producer summary was returned.",
        "story_arc": clean_optional_string(analysis.get("story_arc")) or "No story arc was returned.",
        "editorial_use": clean_optional_string(analysis.get("editorial_use")) or "Use as a selected clip after Marengo retrieval.",
        "recommended_formats": normalize_analysis_list(analysis.get("recommended_formats")),
        "clip_boundary_notes": clean_optional_string(analysis.get("clip_boundary_notes")) or "Use the selected Marengo range as the clip boundary.",
        "rights_safety_notes": clean_optional_string(analysis.get("rights_safety_notes")) or "Review the source footage before publishing.",
        "confidence": confidence,
    }


def normalize_participants(value):
    if not isinstance(value, list):
        return []
    participants = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = clean_optional_string(item.get("name"))
        if not name:
            continue
        participants.append(
            {
                "name": name,
                "role": clean_optional_string(item.get("role")) or "Subject",
                "team_or_group": clean_optional_string(item.get("team_or_group")) or "Unknown",
                "evidence": clean_optional_string(item.get("evidence")) or "Visible or audible in the selected clip.",
            }
        )
    return participants[:8]


def create_entity_tracking_response(tag, payload=None):
    game = get_game(tag)
    payload = payload or {}
    force_generate = bool(payload.get("force_generate") or payload.get("regenerate"))
    requested_video = payload.get("video_name") or payload.get("source_video")
    video_target = None
    if requested_video or payload.get("indexed_asset_id") or payload.get("asset_id"):
        video_target = resolve_workspace_video_target(
            game,
            video_name=requested_video,
            indexed_asset_id=payload.get("indexed_asset_id"),
            asset_id=payload.get("asset_id"),
            lookup=payload,
            status_code=404,
        )
    video_name = video_target["video_name"] if video_target else None
    index_id = configured_search_index_id(game)

    if video_name and not force_generate:
        asset_id = video_target["asset_id"] if video_target else asset_id_for_video_name(game, video_name)
        if asset_id:
            indexed_assets = indexed_assets_for_video_metadata(game, index_id, asset_id, video_name)
            for indexed_asset in indexed_assets:
                cached = jockey_entity_tracking_from_indexed_asset(indexed_asset, video_name, asset_id)
                if not cached:
                    continue
                indexed_asset_id = response_id(indexed_asset)
                return jockey_entity_tracking_with_provenance(
                    cached["tracking"],
                    user_metadata=cached["metadata"],
                    index_id=index_id,
                    indexed_asset_id=indexed_asset_id,
                    asset_id=asset_id,
                    video_name=video_name,
                    source="indexed_asset_user_metadata",
                )

    result = twelvelabs_create_response(
        {
            "model": TWELVELABS_MODEL,
            "instructions": jockey_entity_tracking_instructions(),
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": entity_tracking_prompt(game, video_name),
                }
            ],
            "knowledge_store_id": configured_knowledge_store_id(game),
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "entity_tracking",
                    "schema": ENTITY_TRACKING_SCHEMA,
                }
            },
        },
    )
    manifest = parse_jockey_response_json(result, "TwelveLabs Jockey entity tracking response")
    tracking = normalize_entity_tracking(game, video_name, result, manifest)

    if video_name:
        asset_id = video_target["asset_id"] if video_target else asset_id_for_video_name(game, video_name)
        if asset_id:
            indexed_assets = indexed_assets_for_video_metadata(game, index_id, asset_id, video_name)
            indexed_asset = indexed_asset_for_generated_metadata(game, index_id, asset_id, video_name, indexed_assets)
            indexed_asset_id = response_id(indexed_asset)
            if indexed_asset_id:
                user_metadata = store_jockey_entity_tracking(
                    index_id,
                    indexed_asset_id,
                    asset_id,
                    video_name,
                    tracking,
                )
                invalidate_index_videos_cache(tag)
                merged_metadata = indexed_asset_user_metadata(indexed_asset)
                if isinstance(user_metadata, dict):
                    merged_metadata = {**merged_metadata, **user_metadata}
                return jockey_entity_tracking_with_provenance(
                    tracking,
                    user_metadata=merged_metadata,
                    index_id=index_id,
                    indexed_asset_id=indexed_asset_id,
                    asset_id=asset_id,
                    video_name=video_name,
                    source="generated_and_stored_to_user_metadata",
                )

    return tracking


def jockey_entity_tracking_instructions():
    return (
        "You are a senior sports video analyst using TwelveLabs Jockey over a sports knowledge store. "
        "Extract entity tracking from indexed source-footage evidence only. Return JSON only. "
        "Do not invent named people, teams, timestamps, relationships, emotions, or actions. "
        "Use generic entity names such as 'Arsenal players' or 'home crowd' when individual identity is not grounded."
    )


def entity_tracking_prompt(game, video_name=None):
    parts = [
        "Extract an entity tracking manifest for Dashboard display.",
        f"Game context: {game['label']} ({game['sport']}).",
        "Return the most important grounded entities in the footage: players, teams, coaches, officials, fan groups, benches, or broadcast subjects.",
        "For each entity, include 1-5 timestamped appearances with start_time, end_time, action, emotion, and context.",
        "Entity confidence must be 0.01 to 1.0 and should reflect how clearly the footage supports the entity identity and its appearances.",
        "Use source-video timecodes like M:SS or H:MM:SS. Keep appearances short and playable.",
        "Include relationships only when the footage supports a direct interaction, such as goal scorer with teammates, coach reacting to players, crowd reacting to a goal, or opponents contesting a play.",
        "Prefer 4-8 high-value entities over exhaustive tracking. Use empty arrays when evidence is unsupported.",
    ]
    source_videos = game.get("source_videos", [])
    if source_videos:
        parts.append("Registered source videos: " + "; ".join(source_videos))
    if video_name:
        parts.append(f"Analyze only this registered source video: {video_name}.")
    else:
        parts.append("Analyze across the registered source videos in this knowledge store.")
    return "\n".join(parts)


def normalize_entity_tracking(game, video_name, result, manifest):
    if not isinstance(manifest, dict):
        raise ApiError("TwelveLabs Jockey entity tracking response was not an object", 502)
    entities = []
    raw_entities = manifest.get("entities")
    if isinstance(raw_entities, list):
        for item in raw_entities:
            entity = normalize_entity_tracking_entity(item)
            if entity:
                entities.append(entity)
    relationships = []
    raw_relationships = manifest.get("relationships")
    if isinstance(raw_relationships, list):
        for item in raw_relationships:
            relationship = normalize_entity_tracking_relationship(item)
            if relationship:
                relationships.append(relationship)
    return {
        "provider": "twelvelabs",
        "model": TWELVELABS_MODEL,
        "source": "jockey_entity_tracking",
        "response_id": response_id(result),
        "game_tag": game["tag"],
        "video_name": video_name,
        "summary": clean_optional_string(manifest.get("summary")) or "Jockey did not return an entity summary for this source.",
        "entities": entities[:8],
        "relationships": relationships[:10],
    }


def normalize_entity_tracking_entity(value):
    if not isinstance(value, dict):
        return None
    name = clean_optional_string(value.get("name"))
    if not name:
        return None
    appearances = []
    raw_appearances = value.get("appearances")
    if isinstance(raw_appearances, list):
        for item in raw_appearances[:5]:
            appearance = normalize_entity_tracking_appearance(item)
            if appearance:
                appearances.append(appearance)
    confidence = value.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = 0.75
    confidence = min(1, max(0.01, float(confidence)))
    return {
        "name": name,
        "entity_type": clean_optional_string(value.get("entity_type")) or "entity",
        "team_or_group": clean_optional_string(value.get("team_or_group")) or "Unknown",
        "role": clean_optional_string(value.get("role")) or "Observed subject",
        "description": clean_optional_string(value.get("description")) or "Grounded entity from the source footage.",
        "confidence": confidence,
        "appearances": appearances,
    }


def normalize_entity_tracking_appearance(value):
    if not isinstance(value, dict):
        return None
    start_time = clean_optional_string(value.get("start_time"))
    end_time = clean_optional_string(value.get("end_time"))
    action = clean_optional_string(value.get("action"))
    if not (start_time and end_time and action):
        return None
    return {
        "start_time": start_time,
        "end_time": end_time,
        "action": action,
        "emotion": clean_optional_string(value.get("emotion")) or "Not clearly supported",
        "context": clean_optional_string(value.get("context")) or "Source-footage appearance.",
    }


def normalize_entity_tracking_relationship(value):
    if not isinstance(value, dict):
        return None
    entity = clean_optional_string(value.get("entity"))
    related_entity = clean_optional_string(value.get("related_entity"))
    description = clean_optional_string(value.get("description"))
    if not (entity and related_entity and description):
        return None
    return {
        "entity": entity,
        "related_entity": related_entity,
        "timestamp": clean_optional_string(value.get("timestamp")) or "",
        "interaction_type": clean_optional_string(value.get("interaction_type")) or "interaction",
        "description": description,
    }


def normalize_analysis_list(value):
    if not isinstance(value, list):
        return []
    notes = []
    for item in value:
        note = clean_optional_string(item)
        if note:
            notes.append(note)
    return notes[:8]


def create_jockey_chat_response(tag, payload=None):
    game = get_game(tag)
    payload = payload or {}
    message = required_payload_string(payload, "message")
    include_reel = payload.get("include_reel")
    include_reel = bool(include_reel) if include_reel is not None else jockey_message_requests_reel(message)
    default_limit = 1 if include_reel and jockey_message_requests_specific_clip(message) else 4 if include_reel else 0
    limit = optional_payload_int(payload.get("limit"), "limit", default=default_limit, minimum=0, maximum=16)
    if not include_reel:
        limit = 0
    session_id = clean_optional_string(payload.get("session_id"))
    conversation_history = normalize_jockey_conversation_history(payload.get("conversation_history"))
    requested_video = payload.get("video_name") or payload.get("source_video")
    video_name = None
    if requested_video or payload.get("indexed_asset_id") or payload.get("asset_id"):
        video_name = resolve_workspace_video_target(
            game,
            video_name=requested_video,
            indexed_asset_id=payload.get("indexed_asset_id"),
            asset_id=payload.get("asset_id"),
            lookup=payload,
        )["video_name"]

    request_body = {
        "model": TWELVELABS_MODEL,
        "instructions": jockey_chat_instructions(),
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": jockey_chat_prompt(game, message, limit, video_name, include_reel, conversation_history),
            }
        ],
        "knowledge_store_id": configured_knowledge_store_id(game),
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

    result = twelvelabs_create_response(request_body)
    manifest = parse_jockey_response_json(result, "TwelveLabs Jockey chat response")
    return normalize_jockey_chat_manifest(game, message, result, manifest, limit)


def jockey_chat_instructions():
    return (
        "You are a senior sports highlight producer using TwelveLabs Jockey over a sports knowledge store. "
        "Use only indexed video evidence. Answer conversational producer questions plainly, and build clip manifests only when the request asks for a reel, specific clip, playable moment, or showcase highlight. "
        "Use session continuity and the provided recent conversation history to interpret follow-up refinements. "
        "Return JSON only. Do not invent timestamps, filenames, scores, players, clip rationale, or intensity."
    )


def jockey_chat_prompt(game, message, limit, video_name=None, include_reel=False, conversation_history=None):
    parts = [
        "Producer request:",
        message,
        "Always return a concise narrative_summary.",
        f"Game context: {game['label']} ({game['sport']}).",
        "Registered source videos: " + "; ".join(game.get("source_videos", [])),
    ]
    if conversation_history:
        parts.extend(
            [
                "Recent conversation history, newest last. Use this only to resolve follow-up filters or refinements:",
                json.dumps(conversation_history[-5:], ensure_ascii=False),
            ]
        )
    if include_reel:
        parts.extend(
            [
                f"Return up to {limit} ranked clips for a typed timestamp manifest that can be rendered as a simple Jockey reel or clip showcase.",
                "Each clip must include video_reference, start_time, end_time, moment_type, emotional_intensity, jockey_rationale, confidence, and highlight_potential.",
                "confidence is the grounded evidence confidence from 0.01 to 1.0 for the exact timestamp, moment type, and rationale. Omit clips when confidence cannot be supported.",
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


def normalize_jockey_conversation_history(value):
    if not isinstance(value, list):
        return []
    history = []
    for item in value[-5:]:
        if not isinstance(item, dict):
            continue
        prompt = clean_optional_string(item.get("prompt") or item.get("user") or item.get("message"))
        summary = clean_optional_string(item.get("narrative_summary") or item.get("summary") or item.get("assistant"))
        clips = item.get("clips")
        clip_summaries = []
        if isinstance(clips, list):
            for clip in clips[:8]:
                if not isinstance(clip, dict):
                    continue
                clip_summaries.append(
                    {
                        "video_reference": clean_optional_string(clip.get("video_reference")),
                        "start_time": clean_optional_string(clip.get("start_time")),
                        "end_time": clean_optional_string(clip.get("end_time")),
                        "moment_type": clean_optional_string(clip.get("moment_type")),
                        "confidence": clip.get("confidence") if isinstance(clip.get("confidence"), (int, float)) else None,
                    }
                )
        if prompt or summary or clip_summaries:
            history.append(
                {
                    "prompt": prompt,
                    "narrative_summary": summary,
                    "clips": clip_summaries,
                }
            )
    return history


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
        "session_id": jockey_response_session_id(result),
        "message": message,
        "narrative_summary": clean_optional_string(manifest.get("narrative_summary"))
        or "No grounded Jockey-curated moments were returned for this request.",
        "clips": clips,
    }


def jockey_response_session_id(result):
    if not isinstance(result, dict):
        return None
    for key in ("session_id", "response_session_id"):
        value = clean_optional_string(result.get(key))
        if value:
            return value
    session = result.get("session")
    if isinstance(session, dict):
        for key in ("id", "session_id"):
            value = clean_optional_string(session.get(key))
            if value:
                return value
    return clean_optional_string(result.get("id"))


def normalize_jockey_chat_clip(game, raw_clip, index):
    reference = clean_optional_string(raw_clip.get("video_reference"))
    start_time = clean_optional_string(raw_clip.get("start_time"))
    end_time = clean_optional_string(raw_clip.get("end_time"))
    rationale = clean_optional_string(raw_clip.get("jockey_rationale"))
    if not reference or not start_time or not rationale:
        return None

    end_time = end_time or default_end_time(start_time)
    video_name = resolve_jockey_clip_video_name(game, raw_clip, reference)
    stream_info_path = None
    video_url = None
    thumbnail_url = None
    stream_target = video_name or reference
    if stream_target:
        path_target = video_name or reference
        stream_info_path = f"/games/{game['tag']}/stream/{quote(path_target, safe='')}"
    source_asset_id = asset_id_for_selected_clip_analysis(game, video_name, reference, raw_clip)
    potential = raw_clip.get("highlight_potential")
    if not isinstance(potential, (int, float)):
        potential = 0
    potential = min(1, max(0, float(potential)))
    confidence = raw_clip.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = raw_clip.get("confidence_score")
    if not isinstance(confidence, (int, float)):
        confidence = potential or 0.75
    confidence = min(1, max(0.01, float(confidence)))

    return {
        "id": f"jockey-chat-{index}-{sha256(json.dumps(raw_clip, sort_keys=True, default=str).encode()).hexdigest()[:12]}",
        "video_name": video_name,
        "video_reference": reference,
        "start_time": start_time,
        "end_time": end_time,
        "moment_type": clean_optional_string(raw_clip.get("moment_type")) or "jockey_curated",
        "emotional_intensity": clean_optional_string(raw_clip.get("emotional_intensity")) or "unknown",
        "jockey_rationale": rationale,
        "confidence": confidence,
        "highlight_potential": potential,
        "source_asset_id": source_asset_id,
        "thumbnail_url": thumbnail_url,
        "stream_info_path": stream_info_path,
        "video_url": video_url,
    }


def resolve_jockey_clip_video_name(game, raw_clip, reference):
    video_name = video_name_for_reference(game, reference)
    if video_name:
        return video_name
    if isinstance(raw_clip, dict):
        for key in ("video_name", "asset_id", "indexed_asset_id", "filename", "source_video_name"):
            candidate = clean_optional_string(raw_clip.get(key))
            if not candidate:
                continue
            mapped = video_name_for_reference(game, candidate)
            if mapped:
                return mapped
            if candidate in set(game.get("source_videos", [])):
                return candidate
    return None


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
    source_asset_id = marengo_result_source_asset_id(game, raw_result, video_name, reference)

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
        "source_asset_id": source_asset_id,
    }


def marengo_result_source_asset_id(game, raw_result, video_name, reference):
    for key in ("source_asset_id", "asset_id", "assetId", "video_asset_id", "videoAssetId"):
        asset_id = clean_optional_string(raw_result.get(key))
        if asset_id:
            return asset_id

    asset_id = asset_id_for_video_name(game, video_name)
    if asset_id:
        return asset_id

    index_id = configured_search_index_id(game)
    if not index_id:
        return None
    for key in ("indexed_asset_id", "indexedAssetId", "video_id", "id"):
        candidate = clean_optional_string(raw_result.get(key))
        if not candidate:
            continue
        indexed_asset = indexed_asset_for_reference(index_id, candidate)
        if indexed_asset:
            indexed_asset_id = indexed_asset_asset_id(indexed_asset)
            if indexed_asset_id:
                return indexed_asset_id
    indexed_asset = indexed_asset_for_reference(index_id, reference)
    if indexed_asset:
        return indexed_asset_asset_id(indexed_asset)
    return None


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
    get_game(tag)
    clean_name = clean_optional_string(video_name)
    if not clean_name:
        return None
    for path in sorted(THUMBNAILS_DIR.glob(f"{clean_name}.*")):
        if path.is_file() and path.stat().st_size > 0:
            return path
    path = thumbnail_path(clean_name)
    return path if path.exists() and path.stat().st_size > 0 else None


def registered_indexed_thumbnail_url(tag, video_name):
    game = get_game(tag)
    try:
        target = resolve_workspace_video_target(game, video_name=video_name, status_code=404)
    except ApiError:
        return None
    index_id = target["index_id"]
    indexed_asset_id = target["indexed_asset_id"]
    indexed_asset = target["indexed_asset"]
    if indexed_asset_id and not indexed_asset_user_metadata(indexed_asset):
        try:
            indexed_asset = twelvelabs_get_indexed_asset(index_id, indexed_asset_id)
        except ApiError:
            indexed_asset = None
    if not indexed_asset:
        return None
    return indexed_asset_thumbnail_url(indexed_asset_with_user_metadata(index_id, indexed_asset))


def persist_remote_thumbnail(video_name, remote_url):
    if not remote_url:
        return None
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    for path in sorted(THUMBNAILS_DIR.glob(f"{video_name}.*")):
        if path.is_file() and path.stat().st_size > 0:
            return path
    try:
        response = requests.get(remote_url, timeout=30)
        response.raise_for_status()
    except requests.RequestException:
        return None
    content_type = response.headers.get("Content-Type") or "image/jpeg"
    extension = "jpg"
    if "png" in content_type:
        extension = "png"
    elif "webp" in content_type:
        extension = "webp"
    path = THUMBNAILS_DIR / f"{video_name}.{extension}"
    path.write_bytes(response.content)
    return path


def cache_indexed_video_thumbnail(video_name, indexed_asset=None, index_id=None):
    remote_url = None
    if isinstance(indexed_asset, dict):
        remote_url = indexed_asset_thumbnail_url(indexed_asset)
        if not remote_url and index_id:
            remote_url = indexed_asset_thumbnail_url(
                indexed_asset_with_user_metadata(index_id, indexed_asset)
            )
    if remote_url:
        persist_remote_thumbnail(video_name, remote_url)


def placeholder_thumbnail_svg(tag, video_name):
    game = get_game(tag)
    title = escape_svg_text(Path(clean_optional_string(video_name) or "Indexed video").stem)
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


def twelvelabs_stream_info(tag, video_name, reference=None):
    game = get_game(tag)
    requested_video = clean_optional_string(video_name)
    if not requested_video:
        raise ApiError("video_name is required", 404)
    playback_reference = clean_optional_string(reference) or requested_video
    try:
        target = resolve_workspace_video_target(
            game,
            video_name=requested_video,
            reference=playback_reference,
            status_code=404,
        )
        resolved_video_name = target["video_name"]
    except ApiError:
        resolved_video_name = requested_video

    asset_id, asset = resolve_playback_asset(game, resolved_video_name, playback_reference)
    if resolved_video_name == requested_video:
        indexed_name = indexed_asset_workspace_video_name(
            {"asset": asset, "asset_id": asset_id},
            requested_video,
        )
        if indexed_name:
            resolved_video_name = indexed_name

    cache_key = (tag, resolved_video_name, asset_id)
    now = time.time()
    with STREAM_INFO_CACHE_LOCK:
        cached = STREAM_INFO_CACHE.get(cache_key)
        if cached and cached.get("expires_at", 0) > now:
            return dict(cached["stream_info"])

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


def resolve_playback_asset(game, video_name, reference=None):
    candidates = []
    seen = set()

    def add_candidate(asset_id):
        if asset_id and asset_id not in seen:
            seen.add(asset_id)
            candidates.append(asset_id)

    if video_name:
        add_candidate(asset_id_for_video_name(game, video_name))
        index_id = configured_search_index_id(game)
        marengo_id = marengo_video_id_for_video_name(game, video_name)
        if index_id and marengo_id:
            try:
                indexed_asset = twelvelabs_get_indexed_asset(index_id, marengo_id)
                add_candidate(indexed_asset_asset_id(indexed_asset))
            except ApiError:
                pass

    index_id = configured_search_index_id(game)
    if index_id and reference:
        indexed_asset = indexed_asset_for_reference(index_id, reference)
        if indexed_asset:
            add_candidate(indexed_asset_asset_id(indexed_asset))

    last_error = None
    for asset_id in candidates:
        try:
            asset = twelvelabs_get_asset(asset_id)
        except ApiError as exc:
            last_error = exc
            continue
        hls = asset.get("hls") or {}
        if hls.get("manifest_url") and hls.get("status") == "ready":
            return asset_id, asset
        last_error = ApiError(
            {
                "message": "TwelveLabs HLS stream is not ready for this video",
                "asset_id": asset_id,
                "asset_status": asset.get("status"),
                "hls_status": hls.get("status") or "missing",
            },
            409,
        )

    if last_error:
        raise last_error
    raise ApiError("TwelveLabs asset id not found for this video", 404)


def twelvelabs_asset_id_for_video(game, video_name):
    asset_id, _asset = resolve_playback_asset(game, video_name, video_name)
    return asset_id


def generated_reel_clip(tag, video_name, start, end, format_name, clip_name=None):
    get_game(tag)
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

    source_slug = slugify_filename(Path(video_name).stem)
    safe_label = slugify_filename(clip_name or "reel")
    content = render_reel_clip_bytes(source_input, start_seconds, duration, reel_format)
    download_name = f"{source_slug}-{safe_label}-{reel_format['label'].replace(':', 'x')}-{int(start_seconds)}-{int(end_seconds)}.mp4"
    return content, download_name


def generated_assembly_reel(tag, video_name, segments, format_name, assembly_name=None):
    get_game(tag)
    stream_info = twelvelabs_stream_info(tag, video_name)
    source_input = stream_info["manifest_url"]
    segment_ranges = parse_assembly_segments(segments)
    total_duration = sum(end_seconds - start_seconds for start_seconds, end_seconds in segment_ranges)
    if total_duration > 10 * 60:
        raise ApiError("assembly duration must be 10 minutes or less", 400)

    format_key = (format_name or "16x9").strip()
    reel_format = REEL_FORMATS.get(format_key)
    if not reel_format:
        raise ApiError(f"unsupported reel format: {format_name}", 400)

    source_slug = slugify_filename(Path(video_name).stem)
    safe_label = slugify_filename(assembly_name or "lane-assembly")
    segment_signature = ";".join(
        f"{start_seconds:.3f}-{end_seconds:.3f}" for start_seconds, end_seconds in segment_ranges
    )
    cache_hash = sha256(
        f"{tag}|{video_name}|{stream_info.get('asset_id')}|hls|assembly-v4-local|{segment_signature}|{format_key}".encode()
    ).hexdigest()[:16]
    REELS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = REELS_DIR / f"{source_slug}-{safe_label}-assembly-{format_key}-{cache_hash}.mp4"
    if not output_path.exists():
        render_assembly_reel_to_path(source_input, output_path, segment_ranges, reel_format)
    download_name = f"{source_slug}-{safe_label}-assembly-{reel_format['label'].replace(':', 'x')}.mp4"
    return output_path, download_name


def generated_reel_thumbnail(tag, video_name, time, format_name):
    get_game(tag)
    stream_info = twelvelabs_stream_info(tag, video_name)
    source_input = stream_info["manifest_url"]
    time_seconds = parse_reel_seconds(time, "time")
    format_key = (format_name or "9x16").strip()
    reel_format = REEL_FORMATS.get(format_key)
    if not reel_format:
        raise ApiError(f"unsupported reel format: {format_name}", 400)

    source_slug = slugify_filename(Path(video_name).stem)
    cache_hash = sha256(
        f"{tag}|{video_name}|{stream_info.get('asset_id')}|reel-thumb-v1|{time_seconds:.3f}|{format_key}".encode()
    ).hexdigest()[:16]
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = THUMBNAILS_DIR / f"{source_slug}-reel-{format_key}-{cache_hash}.jpg"
    if cache_path.exists():
        return cache_path.read_bytes()

    content = render_reel_thumbnail_bytes(source_input, time_seconds, reel_format)
    cache_path.write_bytes(content)
    return content


def render_assembly_reel_to_path(source_path, output_path, segments, reel_format):
    if len(segments) == 1:
        start_seconds, end_seconds = segments[0]
        render_reel_clip_to_path(
            source_path,
            output_path,
            start_seconds,
            end_seconds - start_seconds,
            reel_format,
            crf=ASSEMBLY_CRF,
        )
        return

    if len(segments) >= ASSEMBLY_PARALLEL_MIN_SEGMENTS:
        try:
            render_assembly_reel_parallel_to_path(source_path, output_path, segments, reel_format)
            return
        except ApiError as parallel_error:
            logging.warning("parallel assembly render failed; trying filter graph: %s", parallel_error)

    try:
        render_assembly_reel_fast_to_path(source_path, output_path, segments, reel_format, include_audio=True)
        return
    except ApiError as audio_error:
        try:
            render_assembly_reel_fast_to_path(source_path, output_path, segments, reel_format, include_audio=False)
            return
        except ApiError as video_error:
            logging.warning(
                "fast assembly render failed; falling back to parallel export: audio=%s video=%s",
                audio_error,
                video_error,
            )
    render_assembly_reel_parallel_to_path(source_path, output_path, segments, reel_format)


def render_assembly_reel_fast_to_path(source_path, output_path, segments, reel_format, include_audio=True):
    width = reel_format["width"]
    height = reel_format["height"]
    input_args = list(FFMPEG_HLS_INPUT_ARGS)
    video_filters = []
    audio_filters = []
    concat_labels = []

    for index, (start_seconds, end_seconds) in enumerate(segments):
        duration = end_seconds - start_seconds
        input_args.extend([
            "-ss",
            f"{start_seconds:.3f}",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(source_path),
        ])
        video_filters.append(
            f"[{index}:v:0]{reel_scale_filter(width, height)},setpts=PTS-STARTPTS[v{index}]"
        )
        if include_audio:
            audio_filters.append(f"[{index}:a:0]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a{index}]")
            concat_labels.append(f"[v{index}][a{index}]")
        else:
            concat_labels.append(f"[v{index}]")

    concat_filter = (
        "".join(concat_labels)
        + f"concat=n={len(segments)}:v=1:a={1 if include_audio else 0}"
        + ("[v][a]" if include_audio else "[v]")
    )
    filter_complex = ";".join(video_filters + audio_filters + [concat_filter])
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *input_args,
        "-filter_complex",
        filter_complex,
        "-map",
        "[v]",
    ]
    if include_audio:
        command.extend(["-map", "[a]"])
    command.extend(ffmpeg_video_encode_args(ASSEMBLY_CRF))
    if include_audio:
        command.extend(ffmpeg_audio_encode_args())
    command.extend(["-movflags", "+faststart", str(output_path)])

    total_duration = sum(end - start for start, end in segments)
    run_ffmpeg_file(
        command,
        output_path,
        timeout=max(180, int(total_duration * 3) + len(segments) * 8 + 45),
        error_prefix=f"assembly {'audio/video' if include_audio else 'video-only'} export failed",
    )


def render_assembly_reel_parallel_to_path(source_path, output_path, segments, reel_format):
    workers = min(ASSEMBLY_SEGMENT_WORKERS, len(segments))
    with tempfile.TemporaryDirectory(prefix="sports-jockey-assembly-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)

        def render_segment(index_segment):
            index, (start_seconds, end_seconds) = index_segment
            segment_path = temp_dir / f"segment-{index:03d}.mp4"
            render_reel_clip_to_path(
                source_path,
                segment_path,
                start_seconds,
                end_seconds - start_seconds,
                reel_format,
                crf=ASSEMBLY_CRF,
            )
            return index, segment_path

        with ThreadPoolExecutor(max_workers=workers) as executor:
            rendered = list(executor.map(render_segment, enumerate(segments)))
        segment_paths = [path for _, path in sorted(rendered, key=lambda item: item[0])]
        concat_segment_files_to_path(segment_paths, output_path)


def concat_segment_files_to_path(segment_paths, output_path):
    if len(segment_paths) == 1:
        shutil.copyfile(segment_paths[0], output_path)
        return

    with tempfile.TemporaryDirectory(prefix="sports-jockey-concat-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        concat_list = temp_dir / "concat.txt"
        concat_list.write_text(
            "".join(f"file '{ffconcat_escape(path)}'\n" for path in segment_paths),
            encoding="utf-8",
        )
        copy_command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        try:
            run_ffmpeg_file(
                copy_command,
                output_path,
                timeout=max(60, len(segment_paths) * 5),
                error_prefix="assembly concat failed",
            )
            return
        except ApiError:
            pass

        reencode_command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-fflags",
            "+genpts",
            *ffmpeg_video_encode_args(ASSEMBLY_CRF),
            *ffmpeg_audio_encode_args(),
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        run_ffmpeg_file(
            reencode_command,
            output_path,
            timeout=max(120, len(segment_paths) * 20),
            error_prefix="assembly export failed",
        )


def render_reel_clip_bytes(source_path, start_seconds, duration, reel_format, crf=REEL_CRF):
    width = reel_format["width"]
    height = reel_format["height"]
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *FFMPEG_HLS_INPUT_ARGS,
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
        reel_scale_filter(width, height),
        *ffmpeg_video_encode_args(crf),
        *ffmpeg_audio_encode_args(),
        "-f",
        "mp4",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
    ]
    return run_ffmpeg_bytes(
        command,
        timeout=max(90, int(duration * 2) + 25),
        error_prefix="reel export failed",
    )


def render_reel_clip_to_path(source_path, output_path, start_seconds, duration, reel_format, crf=REEL_CRF):
    width = reel_format["width"]
    height = reel_format["height"]
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *FFMPEG_HLS_INPUT_ARGS,
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
        reel_scale_filter(width, height),
        *ffmpeg_video_encode_args(crf),
        *ffmpeg_audio_encode_args(),
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    run_ffmpeg_file(
        command,
        output_path,
        timeout=max(90, int(duration * 2) + 25),
        error_prefix="reel export failed",
    )


def render_reel_thumbnail_bytes(source_path, time_seconds, reel_format):
    width = reel_format["width"]
    height = reel_format["height"]
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *FFMPEG_HLS_INPUT_ARGS,
        "-ss",
        f"{time_seconds:.3f}",
        "-i",
        str(source_path),
        "-frames:v",
        "1",
        "-vf",
        reel_scale_filter(width, height),
        "-q:v",
        "3",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]
    return run_ffmpeg_bytes(command, timeout=45, error_prefix="reel thumbnail failed")


def reel_scale_filter(width, height):
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=bilinear,"
        f"crop={width}:{height},setsar=1"
    )


def ffmpeg_video_encode_args(crf):
    return [
        "-c:v",
        "libx264",
        "-preset",
        FFMPEG_PRESET,
        "-crf",
        str(crf),
        "-threads",
        "0",
        "-pix_fmt",
        "yuv420p",
    ]


def ffmpeg_audio_encode_args():
    return ["-c:a", "aac", "-b:a", "128k"]


def run_ffmpeg_bytes(command, timeout, error_prefix):
    result = subprocess.run(
        command,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0 or not result.stdout:
        detail = (result.stderr.decode("utf-8", errors="replace") if result.stderr else "").strip()
        if not detail and result.stdout:
            detail = "ffmpeg returned empty output"
        if not detail:
            detail = "ffmpeg failed"
        raise ApiError(f"{error_prefix}: {detail}", 500)
    return result.stdout


def run_ffmpeg_file(command, output_path, timeout, error_prefix):
    result = subprocess.run(
        command,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size <= 0:
        try:
            output_path.unlink(missing_ok=True)
        except OSError:
            pass
        detail = (result.stderr.decode("utf-8", errors="replace") if result.stderr else "").strip()
        if not detail:
            detail = "ffmpeg failed"
        raise ApiError(f"{error_prefix}: {detail}", 500)


def parse_reel_seconds(value, field_name):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field_name} must be a number of seconds", 400)
    if seconds < 0:
        raise ApiError(f"{field_name} must be zero or greater", 400)
    return seconds


def parse_assembly_segments(value):
    raw_value = (value or "").strip()
    if not raw_value:
        raise ApiError("segments are required", 400)

    ranges = []
    for index, raw_segment in enumerate(raw_value.split(";"), start=1):
        segment = raw_segment.strip()
        if not segment:
            continue
        if "-" not in segment:
            raise ApiError(f"segment {index} must use start-end seconds", 400)
        raw_start, raw_end = segment.split("-", 1)
        start_seconds = parse_reel_seconds(raw_start.strip(), f"segment {index} start")
        end_seconds = parse_reel_seconds(raw_end.strip(), f"segment {index} end")
        if end_seconds <= start_seconds:
            raise ApiError(f"segment {index} end must be greater than start", 400)
        ranges.append((start_seconds, end_seconds))

    if not ranges:
        raise ApiError("segments are required", 400)
    if len(ranges) > 80:
        raise ApiError("assembly can include at most 80 segments", 400)
    return ranges


def ffconcat_escape(path):
    return str(path).replace("'", "'\\''")


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
    if reference.startswith("ksi_"):
        bare_reference = reference.removeprefix("ksi_")
        if isinstance(reference_map, dict) and bare_reference in reference_map:
            return reference_map[bare_reference]
    elif isinstance(reference_map, dict):
        prefixed_reference = f"ksi_{reference}"
        if prefixed_reference in reference_map:
            return reference_map[prefixed_reference]
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

    index_id = configured_search_index_id(game)
    if index_id:
        indexed_asset = indexed_asset_for_reference(index_id, reference)
        if indexed_asset:
            asset_id = indexed_asset_asset_id(indexed_asset)
            if isinstance(asset_map, dict) and asset_id:
                for video_name, mapped_asset_id in asset_map.items():
                    if mapped_asset_id == asset_id:
                        return video_name
            workspace_name = indexed_asset_workspace_video_name(indexed_asset, reference)
            if workspace_name:
                if workspace_name in source_videos:
                    return workspace_name
                normalized_workspace = workspace_name.lower()
                for video_name in source_videos:
                    if video_name.lower() == normalized_workspace:
                        return video_name
                return workspace_name

    basename = Path(reference).name
    if basename in source_videos:
        return basename

    normalized_reference = reference.lower()
    best_match = None
    best_score = -1
    for video_name in source_videos:
        normalized_video = video_name.lower()
        stem = Path(video_name).stem.lower()
        if normalized_reference == normalized_video:
            return video_name
        score = 0
        if normalized_video in normalized_reference or normalized_reference in normalized_video:
            score = max(len(normalized_video), len(normalized_reference))
        elif stem in normalized_reference or normalized_reference in stem:
            score = max(len(stem), len(normalized_reference)) - 1
        if score > best_score:
            best_score = score
            best_match = video_name
    return best_match if best_score > 0 else None


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


def workspace_lookup_kwargs(lookup=None):
    if not isinstance(lookup, dict):
        return {}
    resolved = {}
    for key in ("indexed_asset_id", "asset_id", "reference", "video_name", "source_video"):
        value = clean_optional_string(lookup.get(key))
        if value:
            resolved[key] = value
    return resolved


def resolve_workspace_video_target(
    game,
    *,
    video_name=None,
    indexed_asset_id=None,
    asset_id=None,
    reference=None,
    lookup=None,
    status_code=404,
):
    """Resolve a Dashboard video from the TwelveLabs index without requiring source_videos registration."""
    lookup = workspace_lookup_kwargs(lookup)
    video_name = clean_optional_string(video_name) or lookup.get("video_name") or lookup.get("source_video")
    indexed_asset_id = clean_optional_string(indexed_asset_id) or lookup.get("indexed_asset_id")
    asset_id = clean_optional_string(asset_id) or lookup.get("asset_id")
    reference = clean_optional_string(reference) or lookup.get("reference")

    index_id = configured_search_index_id(game)
    if not index_id:
        raise ApiError("TwelveLabs search index is not configured for this game", status_code)

    references = []
    for value in (indexed_asset_id, asset_id, reference, video_name):
        if value and value not in references:
            references.append(value)
    if video_name:
        mapped_name = video_name_for_reference(game, video_name)
        if mapped_name and mapped_name not in references:
            references.append(mapped_name)

    indexed_asset = None
    for candidate in references:
        indexed_asset = indexed_asset_for_reference(index_id, candidate)
        if indexed_asset:
            break

    if not indexed_asset:
        raise ApiError("video is not available in the configured TwelveLabs index", status_code)

    resolved_indexed_asset_id = response_id(indexed_asset)
    resolved_asset_id = indexed_asset_asset_id(indexed_asset)
    if not resolved_asset_id:
        raise ApiError("TwelveLabs indexed asset does not include an asset id", status_code)

    resolved_video_name = indexed_asset_workspace_video_name(indexed_asset, video_name or reference)
    mapped_video_name = video_name_for_reference(game, video_name or reference or resolved_video_name)
    if mapped_video_name:
        resolved_video_name = mapped_video_name

    return {
        "video_name": resolved_video_name,
        "index_id": index_id,
        "indexed_asset_id": resolved_indexed_asset_id,
        "asset_id": resolved_asset_id,
        "indexed_asset": indexed_asset,
    }


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


def validate_source_videos(source_videos, remote_asset_ids=None):
    if source_videos is None:
        return []
    if not isinstance(source_videos, list):
        raise ApiError("source_videos must be an array", 400)

    remote_asset_ids = remote_asset_ids if isinstance(remote_asset_ids, dict) else {}
    validated = []
    for video_name in source_videos:
        if not isinstance(video_name, str) or not video_name.strip():
            raise ApiError("source_videos must contain only non-empty strings", 400)
        clean_name = video_name.strip()
        path = video_path(clean_name)
        if path.exists():
            validated.append(clean_name)
            continue
        if clean_optional_string(remote_asset_ids.get(clean_name)):
            validated.append(clean_name)
            continue
        raise ApiError(f"source video not found: {clean_name}", 400)
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
