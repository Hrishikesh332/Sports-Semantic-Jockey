import json
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
from app.services.highlights import generate_highlight_reels


ROOT_DIR = Path(__file__).resolve().parents[2]
LOGS_DIR = ROOT_DIR / "logs"
VIDEOS_DIR = ROOT_DIR / "data" / "videos"
DEFAULT_GAME_TAG = "sports"
DEFAULT_POLL_INTERVAL_SECONDS = int(os.environ.get("SPORTS_INGEST_POLL_INTERVAL_SECONDS", "60"))
DEFAULT_POLL_ATTEMPTS = int(os.environ.get("SPORTS_INGEST_POLL_ATTEMPTS", "720"))
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
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    ensure_video_links(spec["source_videos"], progress)

    state_path = ingestion_state_path(spec["state_file"], spec["tag"])
    state = load_state(state_path)
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
    save_state(state_path, state)

    store_id = spec["knowledge_store_id"] or state.get("knowledge_store_id")
    if not store_id:
        store = create_knowledge_store(spec)
        store_id = store["_id"]
        state["knowledge_store_id"] = store_id
        state["knowledge_store"] = store
        save_state(state_path, state)
        progress(f"created knowledge store {store_id}")
    else:
        state["knowledge_store_id"] = store_id
        save_state(state_path, state)
        progress(f"using existing knowledge store {store_id}")

    upload_source_assets(spec["source_videos"], state_path, state, progress)
    upload_index_assets(spec["index_videos"], state_path, state, progress)
    add_index_items(store_id, spec["index_videos"], state_path, state, progress)
    poll_items_until_ready(
        store_id=store_id,
        state_path=state_path,
        state=state,
        poll_attempts=spec["poll_attempts"],
        poll_interval_seconds=spec["poll_interval_seconds"],
        progress=progress,
    )

    video_reference_map = build_video_reference_map(state, spec["index_videos"])
    video_reference_offsets = build_video_reference_offsets(state, spec["index_videos"])
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
    save_state(state_path, state)
    progress(f"registered {spec['tag']} game")

    if not all(status == "ready" for status in state["item_statuses"].values()):
        return build_ingestion_response(spec, state_path, state, game, "indexing")

    if spec["generate_highlights"]:
        highlight_response_logs = generate_video_highlights(
            source_videos=spec["source_videos"],
            index_videos=spec["index_videos"],
            store_id=store_id,
            video_reference_map=video_reference_map,
            video_reference_offsets=video_reference_offsets,
            state_path=state_path,
            state=state,
            force=spec["force_regenerate_highlights"],
            progress=progress,
        )
        game_payload["highlight_response_logs"] = highlight_response_logs
        game = register_game(game_payload)
        state["registered_game"] = game
        save_state(state_path, state)
        progress(f"registered {spec['tag']} highlight response logs")

    return build_ingestion_response(spec, state_path, state, game, "ready")


def parse_ingestion_payload(payload):
    if not isinstance(payload, dict):
        raise ApiError("JSON object body is required", 400)

    tag = required_string(payload, "tag", DEFAULT_GAME_TAG)
    label = required_string(payload, "label", tag.title())
    sport = required_string(payload, "sport", label)
    source_videos = parse_source_videos(payload.get("source_videos"))
    index_videos = parse_index_videos(payload.get("index_videos"), source_videos)
    state_file = optional_file_name(payload.get("state_file")) or f"{tag}_ingest_state.json"
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
        "state_file": state_file,
        "generate_highlights": bool(payload.get("generate_highlights", True)),
        "force_regenerate_highlights": bool(payload.get("force_regenerate_highlights", False)),
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


def upload_source_assets(source_videos, state_path, state, progress):
    for video in source_videos:
        if state["source_asset_ids"].get(video.name):
            progress(f"source asset already uploaded for {video.name}: {state['source_asset_ids'][video.name]}")
            continue
        if state["asset_ids"].get(video.name):
            state["source_asset_ids"][video.name] = state["asset_ids"][video.name]
            save_state(state_path, state)
            progress(f"using existing asset for source {video.name}: {state['source_asset_ids'][video.name]}")
            continue
        asset = upload_video_asset(video.name, video.path, state_path, state, progress)
        state["source_asset_ids"][video.name] = asset["_id"]
        state["asset_ids"][video.name] = asset["_id"]
        state.setdefault("assets", {})[video.name] = asset
        save_state(state_path, state)
        progress(f"uploaded source asset {asset['_id']} for {video.name}")


def upload_index_assets(index_videos, state_path, state, progress):
    for video in index_videos:
        if state["asset_ids"].get(video.name):
            progress(f"index asset already uploaded for {video.name}: {state['asset_ids'][video.name]}")
            continue
        if video.name == video.source_name and state["source_asset_ids"].get(video.source_name):
            state["asset_ids"][video.name] = state["source_asset_ids"][video.source_name]
            save_state(state_path, state)
            progress(f"using source asset for index video {video.name}: {state['asset_ids'][video.name]}")
            continue
        asset = upload_video_asset(video.name, video.path, state_path, state, progress)
        state["asset_ids"][video.name] = asset["_id"]
        state.setdefault("assets", {})[video.name] = asset
        save_state(state_path, state)
        progress(f"uploaded index asset {asset['_id']} for {video.name}")


def upload_video_asset(video_name, path, state_path, state, progress):
    multipart_state = state.setdefault("multipart_uploads", {}).setdefault(video_name, {})

    def save_upload_state():
        save_state(state_path, state)

    progress(f"uploading {video_name} ({path.stat().st_size / (1024 ** 3):.2f} GB)")
    return upload_asset_path(
        path,
        multipart_state=multipart_state,
        on_state_change=save_upload_state,
        progress=progress,
    )


def add_index_items(store_id, index_videos, state_path, state, progress):
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
        save_state(state_path, state)
        progress(f"added item {item['_id']} for {video.name}")


def poll_items_until_ready(store_id, state_path, state, poll_attempts, poll_interval_seconds, progress):
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
        save_state(state_path, state)
        if any(status == "failed" for status in state["item_statuses"].values()):
            raise ApiError("one or more knowledge store items failed indexing", 502)
        if not pending:
            return
        progress(f"waiting {poll_interval_seconds}s for indexing, attempt {attempt}/{poll_attempts}")
        if poll_interval_seconds:
            time.sleep(poll_interval_seconds)


def generate_video_highlights(
    source_videos,
    index_videos,
    store_id,
    video_reference_map,
    video_reference_offsets,
    state_path,
    state,
    force,
    progress,
):
    highlight_response_logs = state.setdefault("highlight_response_logs", {})
    source_names_with_parts = source_names_indexed_as_parts(index_videos)
    for source_video in source_videos:
        if not force and not should_generate_video_highlights(state, source_video.name, progress):
            progress(f"highlight response already generated for {source_video.name}: {highlight_response_logs[source_video.name]}")
            continue
        reels = generate_highlight_reels(
            knowledge_store_id=store_id,
            match_context=single_video_match_context(
                source_video.name,
                split_into_parts=source_video.name in source_names_with_parts,
            ),
        )
        reels = normalize_reel_references(reels, video_reference_map, video_reference_offsets)
        reels = filter_reels_to_source(reels, source_video.name)
        log_name = f"{timestamp()}_{slugify(source_video.path.stem)}_highlight_reels.json"
        (LOGS_DIR / log_name).write_text(json.dumps(reels, indent=2, ensure_ascii=False))
        highlight_response_logs[source_video.name] = log_name
        state["highlight_response_logs"] = highlight_response_logs
        save_state(state_path, state)
        progress(f"generated Jockey highlight response for {source_video.name}: {log_name}")
    return highlight_response_logs


def source_names_indexed_as_parts(index_videos):
    names = {}
    for video in index_videos:
        names.setdefault(video.source_name, set()).add(video.name)
    return {source_name for source_name, indexed_names in names.items() if indexed_names != {source_name}}


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


def build_video_reference_offsets(state, index_videos):
    offsets = {}
    specs = {video.name: video for video in index_videos}
    for video_name, item_id in state["item_ids"].items():
        offset = specs.get(video_name, IndexVideo(video_name, Path(video_name), video_name)).offset_seconds
        offsets[video_name] = offset
        asset_id = state.get("asset_ids", {}).get(video_name)
        if asset_id:
            offsets[asset_id] = offset
        offsets[item_id] = offset
        if item_id.startswith("ksi_"):
            offsets[item_id.removeprefix("ksi_")] = offset
    return offsets


def normalize_reel_references(reels, video_reference_map, video_reference_offsets):
    for category in HIGHLIGHT_CATEGORY_KEYS:
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
    for category in HIGHLIGHT_CATEGORY_KEYS:
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


def source_asset_ids_for_game(source_videos, state):
    asset_ids = {}
    for video in source_videos:
        asset_id = state.get("source_asset_ids", {}).get(video.name) or state.get("asset_ids", {}).get(video.name)
        if not asset_id:
            raise ApiError(f"source asset id missing for video: {video.name}", 500)
        asset_ids[video.name] = asset_id
    return asset_ids


def should_generate_video_highlights(state, source_name, progress):
    log_name = state.get("highlight_response_logs", {}).get(source_name)
    if not log_name:
        return True
    log_path = LOGS_DIR / log_name
    if not log_path.exists():
        return True
    reels = json.loads(log_path.read_text())
    invalid_confidences = invalid_reel_confidences(reels)
    if invalid_confidences:
        preview = ", ".join(invalid_confidences[:6])
        if len(invalid_confidences) > 6:
            preview = f"{preview}, ..."
        progress(f"regenerating Jockey response for {source_name}; found unusable confidence values: {preview}")
        return True
    coverage_issue = timeline_coverage_issue(reels)
    if coverage_issue:
        progress(f"regenerating Jockey response for {source_name}; {coverage_issue}")
        return True
    references = clip_references(reels)
    leaked_sources = sorted(reference for reference in references if reference != source_name)
    if leaked_sources:
        progress(f"regenerating Jockey response for {source_name}; found non-video references: {', '.join(leaked_sources)}")
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


def single_video_match_context(source_name, split_into_parts=False):
    extra = ""
    if split_into_parts:
        extra = (
            " This source video is indexed as sequential parts because of the knowledge store media size limit; "
            "treat those parts as this one continuous source video."
        )
    return (
        f"Sports knowledge base request for the single source video named {source_name}. "
        f"Use only evidence from {source_name}: clips, timestamps, teams, players, score context, crowd moments, "
        "emotions, and broadcast details must all come from that one video. Do not create a collective reel, "
        "do not balance across videos, and do not compare or blend facts with any other video in the knowledge store."
        f"{extra}"
    )


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


def build_ingestion_response(spec, state_path, state, game, status):
    return {
        "status": status,
        "state_file": state_path.name,
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
        "highlight_response_logs": state.get("highlight_response_logs", {}),
        "game": public_game(game),
    }


def ingestion_state_path(file_name, tag):
    clean_name = optional_file_name(file_name) or f"{tag}_ingest_state.json"
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    return LOGS_DIR / clean_name


def load_state(path):
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_state(path, state):
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False))


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


def optional_file_name(value):
    if value is None:
        return None
    name = optional_string(value)
    if Path(name).name != name:
        raise ApiError("state_file must be a file name", 400)
    return name


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


def slugify(value):
    slug = "".join(character.lower() if character.isalnum() else "-" for character in value)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-") or "video"
