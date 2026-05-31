"""Persist producer-saved Jockey workspace items on TwelveLabs indexed asset user_metadata."""

import json
import time
from hashlib import sha256

from app.core.errors import ApiError
from app.integrations.twelvelabs import request_json as twelvelabs_request_json

JOCKEY_WORKSPACE_FIELD = "sports_jockey_workspace_v1"
JOCKEY_WORKSPACE_SUMMARY_FIELD = "sports_jockey_workspace_summary_v1"
JOCKEY_WORKSPACE_SCHEMA_VERSION = 1
JOCKEY_WORKSPACE_MAX_ITEMS = 100
JOCKEY_HIGHLIGHT_REELS_FIELD = "sports_jockey_highlight_reels_v1"
JOCKEY_HIGHLIGHT_REELS_SUMMARY_FIELD = "sports_jockey_highlight_reels_summary_v1"
JOCKEY_HIGHLIGHT_REELS_SCHEMA_VERSION = 1
JOCKEY_ENTITY_TRACKING_FIELD = "sports_jockey_entity_tracking_v1"
JOCKEY_ENTITY_TRACKING_SUMMARY_FIELD = "sports_jockey_entity_tracking_summary_v1"
JOCKEY_ENTITY_TRACKING_SCHEMA_VERSION = 1
JOCKEY_WORKSPACE_VERIFY_ATTEMPTS = 3
JOCKEY_WORKSPACE_VERIFY_INTERVAL_SECONDS = 1.0


def get_jockey_workspace_metadata(tag, video_name):
    game, index_id, indexed_asset_id, asset_id, video_name = _resolve_storage_target(tag, video_name)
    workspace = _load_workspace(index_id, indexed_asset_id)
    return {
        "game_tag": game["tag"],
        "video_name": video_name,
        "index_id": index_id,
        "indexed_asset_id": indexed_asset_id,
        "asset_id": asset_id,
        "workspace": workspace,
        "summary": workspace_summary(workspace),
        "storage": "indexed_asset_user_metadata",
        "metadata_field": JOCKEY_WORKSPACE_FIELD,
        "summary_field": JOCKEY_WORKSPACE_SUMMARY_FIELD,
    }


def find_saved_clip_analysis(tag, video_name, start_time, end_time=None, query=None):
    from app.services.games import seconds_from_timecode

    start_seconds = seconds_from_timecode(start_time)
    if start_seconds is None:
        return None
    end_seconds = seconds_from_timecode(end_time) if end_time else None
    if end_seconds is None or end_seconds <= start_seconds:
        end_seconds = start_seconds + 12

    _game, index_id, indexed_asset_id, _asset_id, video_name = _resolve_storage_target(tag, video_name)
    workspace = _load_workspace(index_id, indexed_asset_id)
    saved_items = workspace.get("saved_items") if isinstance(workspace.get("saved_items"), list) else []

    normalized_query = _normalize_lookup_text(query)
    best = None
    best_score = -1

    for item in reversed(saved_items):
        if not isinstance(item, dict) or item.get("kind") != "clip_analysis":
            continue
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        analysis = payload.get("analysis") if isinstance(payload.get("analysis"), dict) else {}
        bounds = item.get("clip_bounds") if isinstance(item.get("clip_bounds"), dict) else {}
        item_start = seconds_from_timecode(bounds.get("start_time") or analysis.get("start_time"))
        item_end = seconds_from_timecode(bounds.get("end_time") or analysis.get("end_time"))
        if item_start is None or item_end is None:
            continue
        if item_start != start_seconds or item_end != end_seconds:
            continue

        score = 0
        search_context = payload.get("search_context") if isinstance(payload.get("search_context"), dict) else {}
        item_query = _normalize_lookup_text(search_context.get("query") or search_context.get("title"))
        if normalized_query and item_query:
            if normalized_query == item_query:
                score += 2
            elif normalized_query in item_query or item_query in normalized_query:
                score += 1
        if score > best_score:
            best_score = score
            best = item

    if not best:
        return None

    payload = best.get("payload") if isinstance(best.get("payload"), dict) else {}
    analysis = payload.get("analysis")
    if not isinstance(analysis, dict):
        return None
    return {
        "analysis": analysis,
        "item": best,
        "search_context": payload.get("search_context") if isinstance(payload.get("search_context"), dict) else {},
    }


def append_saved_clip_analysis(tag, video_name, payload):
    payload = payload if isinstance(payload, dict) else {}
    analysis = payload.get("analysis")
    if not isinstance(analysis, dict):
        raise ApiError("analysis must be an object", 400)

    search_context = payload.get("search_context") if isinstance(payload.get("search_context"), dict) else {}
    item_payload = {
        "analysis": analysis,
        "search_context": search_context,
    }
    item = _build_saved_item(
        kind="clip_analysis",
        model=analysis.get("model") or "pegasus1.5",
        source="discover_selected_clip_analysis",
        video_name=video_name,
        payload=item_payload,
        clip_bounds={
            "start_time": analysis.get("start_time") or search_context.get("start_time"),
            "end_time": analysis.get("end_time") or search_context.get("end_time"),
        },
        title=search_context.get("title") or search_context.get("query") or analysis.get("description"),
    )
    return _append_item_for_video(tag, video_name, item)


def append_saved_jockey_turn(tag, video_name, payload):
    payload = payload if isinstance(payload, dict) else {}
    response = payload.get("response")
    if not isinstance(response, dict):
        raise ApiError("response must be an object", 400)

    prompt = _clean(payload.get("prompt"))
    if not prompt:
        raise ApiError("prompt is required", 400)

    clips = response.get("clips") if isinstance(response.get("clips"), list) else []
    scoped_clips = [_clip_for_video(clip, video_name) for clip in clips]
    scoped_clips = [clip for clip in scoped_clips if clip is not None]
    if clips and not scoped_clips:
        raise ApiError(f"Jockey turn has no clips for source video: {video_name}", 400)

    item_payload = {
        "prompt": prompt,
        "skill_key": _clean(payload.get("skill_key")),
        "show_reel": bool(payload.get("show_reel")),
        "session_id": _clean(response.get("session_id")),
        "narrative_summary": _clean(response.get("narrative_summary")) or _clean(response.get("message")),
        "clips": scoped_clips,
    }
    item = _build_saved_item(
        kind="jockey_turn",
        model="jockey1.0",
        source="jockey_chat",
        video_name=video_name,
        payload=item_payload,
        clip_bounds=_clip_bounds_from_clips(scoped_clips),
        title=prompt,
    )
    return _append_item_for_video(tag, video_name, item)


def append_saved_jockey_turns_for_exchange(tag, payload):
    payload = payload if isinstance(payload, dict) else {}
    response = payload.get("response")
    if not isinstance(response, dict):
        raise ApiError("response must be an object", 400)

    from app.services.games import get_game, resolve_jockey_clip_video_name

    game = get_game(tag)
    clips = response.get("clips") if isinstance(response.get("clips"), list) else []
    target_videos = []
    seen = set()
    for clip in clips:
        if not isinstance(clip, dict):
            continue
        video_name = _clean(clip.get("video_name")) or resolve_jockey_clip_video_name(
            game,
            clip,
            _clean(clip.get("video_reference")),
        )
        if video_name and video_name not in seen:
            seen.add(video_name)
            target_videos.append(video_name)

    if not target_videos:
        raise ApiError(
            "Cannot save this Jockey turn without a registered source video. Ask for a reel or clip from a specific game video.",
            400,
        )

    saved = []
    for video_name in target_videos:
        result = append_saved_jockey_turn(tag, video_name, payload)
        saved.append(
            {
                "video_name": video_name,
                "item_id": result["item"]["id"],
                "duplicate": result["duplicate"],
                "counts": result["summary"].get("counts"),
            }
        )
    return {"saved": saved, "storage": "indexed_asset_user_metadata"}


def parse_highlight_reels_summary_from_metadata(metadata):
    if not isinstance(metadata, dict):
        return None
    summary = _parse_json_object(metadata.get(JOCKEY_HIGHLIGHT_REELS_SUMMARY_FIELD))
    if summary:
        return summary
    detail = _parse_json_object(metadata.get(JOCKEY_HIGHLIGHT_REELS_FIELD))
    if not detail:
        return None
    return {
        "schema_version": detail.get("schema_version"),
        "source_video_name": detail.get("source_video_name"),
        "generated_at": detail.get("generated_at"),
        "model": detail.get("model"),
        "clip_counts": detail.get("clip_counts"),
    }


def jockey_highlight_reels_from_indexed_asset(indexed_asset, video_name=None, asset_id=None):
    from app.core.config import TWELVELABS_MODEL
    from app.services.games import is_complete_highlight_reels

    metadata = _indexed_asset_user_metadata(indexed_asset)
    detail = _parse_json_object(metadata.get(JOCKEY_HIGHLIGHT_REELS_FIELD))
    if not detail or detail.get("schema_version") != JOCKEY_HIGHLIGHT_REELS_SCHEMA_VERSION:
        return None
    detail_video = _clean(detail.get("source_video_name"))
    if video_name and detail_video and detail_video != video_name:
        return None
    detail_asset_id = _clean(detail.get("asset_id"))
    if asset_id and detail_asset_id and detail_asset_id != asset_id:
        return None
    detail_model = _clean(detail.get("model"))
    if detail_model and detail_model != TWELVELABS_MODEL:
        return None
    reels = detail.get("response")
    if not is_complete_highlight_reels(reels):
        return None
    return {
        "reels": reels,
        "detail": detail,
        "metadata": metadata,
    }


def store_jockey_highlight_reels(index_id, indexed_asset_id, asset_id, video_name, reels, match_context=None, wsc_baseline=None):
    from app.core.config import TWELVELABS_MODEL
    from app.services.games import is_complete_highlight_reels, pegasus_reels_clip_counts

    if not is_complete_highlight_reels(reels):
        return {}
    generated_at = _timestamp()
    clip_counts = pegasus_reels_clip_counts(reels)
    detail = {
        "schema_version": JOCKEY_HIGHLIGHT_REELS_SCHEMA_VERSION,
        "provider": "sports-jockey",
        "model": TWELVELABS_MODEL,
        "index_id": index_id,
        "indexed_asset_id": indexed_asset_id,
        "asset_id": asset_id,
        "source_video_name": video_name,
        "generated_at": generated_at,
        "match_context": match_context,
        "wsc_baseline": wsc_baseline,
        "clip_counts": clip_counts,
        "response": reels,
    }
    summary = {
        "schema_version": JOCKEY_HIGHLIGHT_REELS_SCHEMA_VERSION,
        "source_video_name": video_name,
        "generated_at": generated_at,
        "model": TWELVELABS_MODEL,
        "clip_counts": clip_counts,
    }
    patch = {
        JOCKEY_HIGHLIGHT_REELS_FIELD: json.dumps(detail, ensure_ascii=False, separators=(",", ":")),
        JOCKEY_HIGHLIGHT_REELS_SUMMARY_FIELD: json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
    }
    _patch_user_metadata(index_id, indexed_asset_id, patch)
    return patch


def jockey_highlight_reels_with_provenance(
    reels,
    *,
    user_metadata=None,
    index_id=None,
    indexed_asset_id=None,
    asset_id=None,
    video_name=None,
    source,
):
    from copy import deepcopy

    from app.core.config import TWELVELABS_MODEL
    from app.services.games import PEGASUS_RESPONSE_METADATA_FIELD, pegasus_reels_clip_counts

    metadata = user_metadata if isinstance(user_metadata, dict) else {}
    detail = _parse_json_object(metadata.get(JOCKEY_HIGHLIGHT_REELS_FIELD))
    summary = _parse_json_object(metadata.get(JOCKEY_HIGHLIGHT_REELS_SUMMARY_FIELD))
    clip_counts = None
    if isinstance(detail.get("clip_counts"), dict):
        clip_counts = detail.get("clip_counts")
    elif isinstance(summary.get("clip_counts"), dict):
        clip_counts = summary.get("clip_counts")
    response = deepcopy(reels)
    response[PEGASUS_RESPONSE_METADATA_FIELD] = {
        "source": source,
        "from_user_metadata": source == "indexed_asset_user_metadata",
        "storage": "indexed_asset_user_metadata",
        "provider": "twelvelabs",
        "model": detail.get("model") or summary.get("model") or TWELVELABS_MODEL,
        "index_id": detail.get("index_id") or index_id,
        "indexed_asset_id": detail.get("indexed_asset_id") or indexed_asset_id,
        "asset_id": detail.get("asset_id") or asset_id,
        "source_video_name": detail.get("source_video_name") or summary.get("source_video_name") or video_name,
        "generated_at": detail.get("generated_at") or summary.get("generated_at"),
        "metadata_fields": sorted(
            key
            for key in (
                JOCKEY_HIGHLIGHT_REELS_FIELD,
                JOCKEY_HIGHLIGHT_REELS_SUMMARY_FIELD,
                JOCKEY_WORKSPACE_FIELD,
                JOCKEY_WORKSPACE_SUMMARY_FIELD,
            )
            if key in metadata
        ),
        "reels_metadata_field": JOCKEY_HIGHLIGHT_REELS_FIELD,
        "detailed_response_metadata_field": JOCKEY_HIGHLIGHT_REELS_SUMMARY_FIELD,
        "clip_counts": clip_counts or pegasus_reels_clip_counts(reels),
    }
    return response


def parse_entity_tracking_summary_from_metadata(metadata):
    if not isinstance(metadata, dict):
        return None
    summary = _parse_json_object(metadata.get(JOCKEY_ENTITY_TRACKING_SUMMARY_FIELD))
    if summary:
        return summary
    detail = _parse_json_object(metadata.get(JOCKEY_ENTITY_TRACKING_FIELD))
    if not detail:
        return None
    response = detail.get("response") if isinstance(detail.get("response"), dict) else {}
    entities = response.get("entities") if isinstance(response.get("entities"), list) else []
    relationships = response.get("relationships") if isinstance(response.get("relationships"), list) else []
    return {
        "schema_version": detail.get("schema_version"),
        "source_video_name": detail.get("source_video_name"),
        "generated_at": detail.get("generated_at"),
        "model": detail.get("model"),
        "entity_count": len(entities),
        "relationship_count": len(relationships),
    }


def is_complete_entity_tracking(tracking):
    if not isinstance(tracking, dict):
        return False
    summary = tracking.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return False
    if not isinstance(tracking.get("entities"), list):
        return False
    if not isinstance(tracking.get("relationships"), list):
        return False
    return True


def jockey_entity_tracking_from_indexed_asset(indexed_asset, video_name=None, asset_id=None):
    from app.core.config import TWELVELABS_MODEL

    metadata = _indexed_asset_user_metadata(indexed_asset)
    detail = _parse_json_object(metadata.get(JOCKEY_ENTITY_TRACKING_FIELD))
    if not detail or detail.get("schema_version") != JOCKEY_ENTITY_TRACKING_SCHEMA_VERSION:
        return None
    detail_video = _clean(detail.get("source_video_name"))
    if video_name and detail_video and detail_video != video_name:
        return None
    detail_asset_id = _clean(detail.get("asset_id"))
    if asset_id and detail_asset_id and detail_asset_id != asset_id:
        return None
    detail_model = _clean(detail.get("model"))
    if detail_model and detail_model != TWELVELABS_MODEL:
        return None
    tracking = detail.get("response")
    if not is_complete_entity_tracking(tracking):
        return None
    return {
        "tracking": tracking,
        "detail": detail,
        "metadata": metadata,
    }


def store_jockey_entity_tracking(index_id, indexed_asset_id, asset_id, video_name, tracking):
    from app.core.config import TWELVELABS_MODEL

    if not is_complete_entity_tracking(tracking):
        return {}
    generated_at = _timestamp()
    entities = tracking.get("entities") if isinstance(tracking.get("entities"), list) else []
    relationships = tracking.get("relationships") if isinstance(tracking.get("relationships"), list) else []
    detail = {
        "schema_version": JOCKEY_ENTITY_TRACKING_SCHEMA_VERSION,
        "provider": "sports-jockey",
        "model": TWELVELABS_MODEL,
        "index_id": index_id,
        "indexed_asset_id": indexed_asset_id,
        "asset_id": asset_id,
        "source_video_name": video_name,
        "generated_at": generated_at,
        "entity_count": len(entities),
        "relationship_count": len(relationships),
        "response": tracking,
    }
    summary = {
        "schema_version": JOCKEY_ENTITY_TRACKING_SCHEMA_VERSION,
        "source_video_name": video_name,
        "generated_at": generated_at,
        "model": TWELVELABS_MODEL,
        "entity_count": len(entities),
        "relationship_count": len(relationships),
    }
    patch = {
        JOCKEY_ENTITY_TRACKING_FIELD: json.dumps(detail, ensure_ascii=False, separators=(",", ":")),
        JOCKEY_ENTITY_TRACKING_SUMMARY_FIELD: json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
    }
    _patch_user_metadata(index_id, indexed_asset_id, patch)
    return patch


def load_cached_video_dashboard(game, video_name):
    from app.services.games import (
        asset_id_for_video_name,
        configured_search_index_id,
        indexed_assets_for_video_metadata,
        response_id,
        validate_registered_video_name,
    )

    video_name = validate_registered_video_name(game, video_name, status_code=404)
    asset_id = asset_id_for_video_name(game, video_name)
    if not asset_id:
        return None
    index_id = configured_search_index_id(game)
    indexed_assets = indexed_assets_for_video_metadata(game, index_id, asset_id, video_name)
    for indexed_asset in indexed_assets:
        highlight = jockey_highlight_reels_from_indexed_asset(indexed_asset, video_name, asset_id)
        entity = jockey_entity_tracking_from_indexed_asset(indexed_asset, video_name, asset_id)
        if not highlight and not entity:
            continue
        indexed_asset_id = response_id(indexed_asset)
        if not indexed_asset_id:
            continue
        metadata = _indexed_asset_user_metadata(indexed_asset)
        return {
            "video_name": video_name,
            "index_id": index_id,
            "indexed_asset_id": indexed_asset_id,
            "asset_id": asset_id,
            "indexed_asset": indexed_asset,
            "metadata": metadata,
            "highlight_reels": highlight,
            "entity_tracking": entity,
        }
    return None


def jockey_entity_tracking_with_provenance(
    tracking,
    *,
    user_metadata=None,
    index_id=None,
    indexed_asset_id=None,
    asset_id=None,
    video_name=None,
    source,
):
    from copy import deepcopy

    from app.core.config import TWELVELABS_MODEL

    metadata = user_metadata if isinstance(user_metadata, dict) else {}
    detail = _parse_json_object(metadata.get(JOCKEY_ENTITY_TRACKING_FIELD))
    summary = _parse_json_object(metadata.get(JOCKEY_ENTITY_TRACKING_SUMMARY_FIELD))
    entities = tracking.get("entities") if isinstance(tracking.get("entities"), list) else []
    relationships = tracking.get("relationships") if isinstance(tracking.get("relationships"), list) else []
    response = deepcopy(tracking)
    response["_jockey_metadata"] = {
        "source": source,
        "from_user_metadata": source == "indexed_asset_user_metadata",
        "storage": "indexed_asset_user_metadata",
        "provider": "twelvelabs",
        "model": detail.get("model") or summary.get("model") or TWELVELABS_MODEL,
        "index_id": detail.get("index_id") or index_id,
        "indexed_asset_id": detail.get("indexed_asset_id") or indexed_asset_id,
        "asset_id": detail.get("asset_id") or asset_id,
        "source_video_name": detail.get("source_video_name") or summary.get("source_video_name") or video_name,
        "generated_at": detail.get("generated_at") or summary.get("generated_at"),
        "entity_count": detail.get("entity_count") if isinstance(detail.get("entity_count"), int) else len(entities),
        "relationship_count": detail.get("relationship_count") if isinstance(detail.get("relationship_count"), int) else len(relationships),
        "metadata_fields": sorted(
            key
            for key in (
                JOCKEY_ENTITY_TRACKING_FIELD,
                JOCKEY_ENTITY_TRACKING_SUMMARY_FIELD,
                JOCKEY_HIGHLIGHT_REELS_FIELD,
                JOCKEY_HIGHLIGHT_REELS_SUMMARY_FIELD,
                JOCKEY_WORKSPACE_FIELD,
                JOCKEY_WORKSPACE_SUMMARY_FIELD,
            )
            if key in metadata
        ),
        "entity_tracking_metadata_field": JOCKEY_ENTITY_TRACKING_FIELD,
        "entity_tracking_summary_field": JOCKEY_ENTITY_TRACKING_SUMMARY_FIELD,
    }
    return response


def parse_workspace_summary_from_metadata(metadata):
    if not isinstance(metadata, dict):
        return None
    summary = _parse_json_object(metadata.get(JOCKEY_WORKSPACE_SUMMARY_FIELD))
    if summary:
        return summary
    workspace = _parse_json_object(metadata.get(JOCKEY_WORKSPACE_FIELD))
    if workspace:
        return workspace_summary(workspace)
    return None


def workspace_summary(workspace):
    if not isinstance(workspace, dict):
        workspace = empty_workspace()
    saved_items = workspace.get("saved_items") if isinstance(workspace.get("saved_items"), list) else []
    counts = {
        "clip_analysis": 0,
        "jockey_turn": 0,
        "total": 0,
    }
    for item in saved_items:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        if kind in counts:
            counts[kind] += 1
        counts["total"] += 1
    return {
        "schema_version": JOCKEY_WORKSPACE_SCHEMA_VERSION,
        "source_video_name": workspace.get("source_video_name"),
        "updated_at": workspace.get("updated_at"),
        "counts": counts,
    }


def empty_workspace(source_video_name=None, index_id=None, indexed_asset_id=None, asset_id=None):
    return {
        "schema_version": JOCKEY_WORKSPACE_SCHEMA_VERSION,
        "provider": "sports-jockey",
        "source_video_name": source_video_name,
        "index_id": index_id,
        "indexed_asset_id": indexed_asset_id,
        "asset_id": asset_id,
        "updated_at": None,
        "saved_items": [],
    }


def _append_item_for_video(tag, video_name, item):
    game, index_id, indexed_asset_id, asset_id, video_name = _resolve_storage_target(tag, video_name)
    workspace = _load_workspace(index_id, indexed_asset_id)
    if not workspace.get("source_video_name"):
        workspace["source_video_name"] = video_name
    if not workspace.get("index_id"):
        workspace["index_id"] = index_id
    if not workspace.get("indexed_asset_id"):
        workspace["indexed_asset_id"] = indexed_asset_id
    if not workspace.get("asset_id"):
        workspace["asset_id"] = asset_id

    duplicate = False
    for existing in workspace.get("saved_items", []):
        if (
            isinstance(existing, dict)
            and existing.get("id") == item["id"]
            and existing.get("kind") == item["kind"]
        ):
            duplicate = True
            item = existing
            break
    else:
        saved_items = workspace.setdefault("saved_items", [])
        saved_items.append(item)
        if len(saved_items) > JOCKEY_WORKSPACE_MAX_ITEMS:
            workspace["saved_items"] = saved_items[-JOCKEY_WORKSPACE_MAX_ITEMS:]
        workspace["updated_at"] = _timestamp()
        _persist_workspace(index_id, indexed_asset_id, workspace)

    summary = workspace_summary(workspace)
    return {
        "game_tag": game["tag"],
        "video_name": video_name,
        "index_id": index_id,
        "indexed_asset_id": indexed_asset_id,
        "asset_id": asset_id,
        "item": item,
        "duplicate": duplicate,
        "summary": summary,
        "storage": "indexed_asset_user_metadata",
    }


def _resolve_storage_target(tag, video_name):
    from app.services.games import (
        asset_id_for_video_name,
        configured_search_index_id,
        indexed_asset_for_generated_metadata,
        indexed_assets_for_video_metadata,
        response_id,
        validate_registered_video_name,
        get_game,
    )

    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    asset_id = asset_id_for_video_name(game, video_name)
    if not asset_id:
        raise ApiError(f"No TwelveLabs asset is registered for source video: {video_name}", 404)

    index_id = configured_search_index_id(game)
    indexed_assets = indexed_assets_for_video_metadata(game, index_id, asset_id, video_name)
    indexed_asset = indexed_asset_for_generated_metadata(game, index_id, asset_id, video_name, indexed_assets)
    indexed_asset_id = response_id(indexed_asset)
    if not indexed_asset_id:
        raise ApiError("TwelveLabs indexed asset id was not found for this source video", 404)
    return game, index_id, indexed_asset_id, asset_id, video_name


def _load_workspace(index_id, indexed_asset_id):
    indexed_asset = twelvelabs_request_json("get", f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}")
    metadata = _indexed_asset_user_metadata(indexed_asset)
    workspace = _parse_json_object(metadata.get(JOCKEY_WORKSPACE_FIELD))
    if workspace:
        return workspace
    return empty_workspace(index_id=index_id, indexed_asset_id=indexed_asset_id)


def _persist_workspace(index_id, indexed_asset_id, workspace):
    summary = workspace_summary(workspace)
    patch = {
        JOCKEY_WORKSPACE_FIELD: json.dumps(workspace, ensure_ascii=False, separators=(",", ":")),
        JOCKEY_WORKSPACE_SUMMARY_FIELD: json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
    }
    _patch_user_metadata(index_id, indexed_asset_id, patch)


def _patch_user_metadata(index_id, indexed_asset_id, patch):
    twelvelabs_request_json(
        "patch",
        f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}",
        {"user_metadata": patch},
    )
    _verify_user_metadata_patch(index_id, indexed_asset_id, patch)


def _verify_user_metadata_patch(index_id, indexed_asset_id, expected_patch):
    expected_keys = set(expected_patch)
    last_metadata = {}
    for attempt in range(1, max(1, JOCKEY_WORKSPACE_VERIFY_ATTEMPTS) + 1):
        indexed_asset = twelvelabs_request_json("get", f"/indexes/{index_id}/indexed-assets/{indexed_asset_id}")
        last_metadata = _indexed_asset_user_metadata(indexed_asset)
        if all(last_metadata.get(key) == expected_patch.get(key) for key in expected_keys):
            return
        if attempt < JOCKEY_WORKSPACE_VERIFY_ATTEMPTS and JOCKEY_WORKSPACE_VERIFY_INTERVAL_SECONDS > 0:
            time.sleep(JOCKEY_WORKSPACE_VERIFY_INTERVAL_SECONDS)
    missing = sorted(key for key in expected_keys if key not in last_metadata)
    mismatched = sorted(
        key for key in expected_keys if key in last_metadata and last_metadata.get(key) != expected_patch.get(key)
    )
    raise ApiError(
        {
            "message": "Jockey workspace metadata was not persisted to TwelveLabs indexed asset user_metadata",
            "index_id": index_id,
            "indexed_asset_id": indexed_asset_id,
            "missing_fields": missing,
            "mismatched_fields": mismatched,
        },
        502,
    )


def _build_saved_item(kind, model, source, video_name, payload, clip_bounds=None, title=None):
    content_hash = _content_hash(kind, video_name, payload)
    saved_at = _timestamp()
    item = {
        "id": f"ws_{kind}_{content_hash}",
        "kind": kind,
        "saved_at": saved_at,
        "video_name": video_name,
        "model": model,
        "source": source,
        "title": _clean(title),
        "content_hash": content_hash,
        "payload": payload,
    }
    if isinstance(clip_bounds, dict):
        start_time = _clean(clip_bounds.get("start_time"))
        end_time = _clean(clip_bounds.get("end_time"))
        if start_time or end_time:
            item["clip_bounds"] = {
                "start_time": start_time,
                "end_time": end_time,
            }
    return item


def _content_hash(kind, video_name, payload):
    body = {"kind": kind, "video_name": video_name, "payload": payload}
    return sha256(json.dumps(body, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _clip_bounds_from_clips(clips):
    if not clips:
        return None
    starts = [_clean(clip.get("start_time")) for clip in clips if isinstance(clip, dict)]
    ends = [_clean(clip.get("end_time")) for clip in clips if isinstance(clip, dict)]
    starts = [value for value in starts if value]
    ends = [value for value in ends if value]
    return {
        "start_time": starts[0] if starts else None,
        "end_time": ends[-1] if ends else None,
    }


def _clip_for_video(clip, video_name):
    if not isinstance(clip, dict):
        return None
    clip_video = _clean(clip.get("video_name"))
    if clip_video and clip_video != video_name:
        return None
    return clip


def _indexed_asset_user_metadata(indexed_asset):
    from app.services.games import indexed_asset_user_metadata

    return indexed_asset_user_metadata(indexed_asset)


def _parse_json_object(value):
    from app.services.games import parse_json_object

    return parse_json_object(value)


def _timestamp():
    from app.services.games import timestamp

    return timestamp()


def _clean(value):
    from app.services.games import clean_optional_string

    return clean_optional_string(value)


def _normalize_lookup_text(value):
    text = _clean(value) or ""
    return " ".join(text.lower().split())
