import json
import re
import subprocess
from datetime import datetime, timezone
from hashlib import sha256
from copy import deepcopy
from pathlib import Path

from app.core.config import TWELVELABS_MODEL
from app.core.errors import ApiError
from app.domain.highlights import validate_highlight_confidences
from app.integrations.twelvelabs import request_json as twelvelabs_request_json
from app.services.highlights import generate_highlight_reels


ROOT_DIR = Path(__file__).resolve().parents[2]
GAMES_DIR = ROOT_DIR / "data" / "games"
LOGS_DIR = ROOT_DIR / "logs"
SPORTS_INGEST_STATE_PATH = LOGS_DIR / "sports_ingest_state.json"
VIDEOS_DIR = ROOT_DIR / "data" / "videos"
THUMBNAILS_DIR = ROOT_DIR / "data" / "thumbnails"
REELS_DIR = ROOT_DIR / "data" / "reels"
REEL_THUMBNAILS_DIR = REELS_DIR / "thumbnails"
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
GENERATED_REEL_LOGS_FIELD = "jockey_reel_response_logs"
GENERATED_REEL_LOG_TYPE = "sports_jockey_generated_highlight_reels"
GENERATED_REEL_LOG_SCHEMA_VERSION = 1
JOCKEY_SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "query_interpretation": {"type": "string"},
        "total_results": {"type": "integer"},
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "video_reference": {"type": "string"},
                    "timestamp": {"type": "string"},
                    "start_time": {"type": "string"},
                    "end_time": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "relevance": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["video_reference", "timestamp", "description", "relevance"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["query_interpretation", "total_results", "results"],
    "additionalProperties": False,
}
JOCKEY_SEARCH_FILTER_PROMPTS = {
    "semantic": "Prioritize semantic or visual/auditory evidence: emotion, crowd atmosphere, reactions, scenes, OCR, speech, and contextual meaning.",
    "standard_stats": "Prioritize scoreboard, scoring, game-state, official event, and stats-style moments.",
    "best_plays": "Prioritize decisive plays, goals, attacks, saves, transitions, momentum swings, and clear game-action peaks.",
    "emotional_moments": "Prioritize player emotion, celebration, frustration, relief, heartbreak, hugs, fist pumps, tears, and tense reactions.",
    "fan_experience": "Prioritize crowd roars, signs, chants, fans, stadium atmosphere, mascots, and broadcast audience reaction.",
    "behind_the_scenes": "Prioritize warmups, benches, coaches, huddles, tunnels, sidelines, and contextual non-play moments.",
}
GAME_DEBUG_FIELDS = {
    "highlight_response_log",
    "highlight_response_logs",
    "jockey_metadata_cache",
    GENERATED_REEL_LOGS_FIELD,
}


def list_games():
    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    games = [public_game(read_json(path)) for path in sorted(GAMES_DIR.glob("*.json"))]
    return {"games": games}


def get_game(tag):
    path = game_path(tag)
    if not path.exists():
        raise ApiError("game not found", 404)
    return read_json(path)


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

    if "wsc_baseline" in payload:
        game["wsc_baseline"] = payload["wsc_baseline"]
    if "highlight_response_log" in payload:
        game["highlight_response_log"] = validate_highlight_response_log(payload["highlight_response_log"])
    highlight_response_logs = validate_highlight_response_logs(payload.get("highlight_response_logs", {}), source_videos)
    if highlight_response_logs:
        game["highlight_response_logs"] = highlight_response_logs
    if isinstance(existing_game.get(GENERATED_REEL_LOGS_FIELD), dict):
        game[GENERATED_REEL_LOGS_FIELD] = existing_game[GENERATED_REEL_LOGS_FIELD]

    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(game, indent=2, ensure_ascii=False))
    return game


def generate_game_highlight_reels(tag, payload=None):
    game = get_game(tag)
    payload = payload or {}
    requested_video = payload.get("video_name") or payload.get("source_video")
    video_name = None
    if requested_video:
        video_name = validate_registered_video_name(game, requested_video)

    if payload.get("use_pinned_log"):
        if video_name:
            video_log = game.get("highlight_response_logs", {}).get(video_name)
            if video_log:
                return highlight_reels_from_log(video_log)
            if game.get("highlight_response_log"):
                reels = highlight_reels_from_log(game["highlight_response_log"])
                return filter_highlight_reels_for_video(game, reels, video_name)
        elif game.get("highlight_response_logs"):
            first_video = next(iter(game["highlight_response_logs"]))
            return highlight_reels_from_log(game["highlight_response_logs"][first_video])
        elif game.get("highlight_response_log"):
            return highlight_reels_from_log(game["highlight_response_log"])

        raise ApiError("pinned highlight response log is not configured for this request", 404)

    match_context = payload.get("match_context") or scoped_match_context(game, video_name)
    wsc_baseline = payload.get("wsc_baseline", game.get("wsc_baseline"))
    context_hash = highlight_cache_context_hash(match_context, wsc_baseline)

    if video_name and not should_refresh_reel_log_cache(payload):
        cached_reels = highlight_reels_from_generated_log_cache(game, video_name, context_hash)
        if cached_reels:
            return cached_reels

    reels = generate_highlight_reels(
        knowledge_store_id=game["knowledge_store_id"],
        match_context=match_context,
        wsc_baseline=wsc_baseline,
    )
    if video_name:
        store_generated_highlight_reels_log_cache(tag, game, video_name, context_hash, reels)
    return reels


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
    if filter_key and filter_key not in JOCKEY_SEARCH_FILTER_PROMPTS:
        raise ApiError("filter is not supported", 400)

    result = twelvelabs_request_json(
        "post",
        "/responses",
        {
            "model": TWELVELABS_MODEL,
            "instructions": jockey_search_instructions(),
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": jockey_search_prompt(game, query, limit, filter_key, video_name),
                }
            ],
            "knowledge_store_id": game["knowledge_store_id"],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "search_results",
                    "schema": JOCKEY_SEARCH_SCHEMA,
                }
            },
        },
    )
    search = parse_jockey_response_json(result, "TwelveLabs Jockey search response")
    return normalize_jockey_search(game, query, search, limit)


def jockey_search_instructions():
    return (
        "You are a precise multimodal video search agent for sports footage. "
        "Use only the indexed knowledge store evidence. Return JSON only. "
        "Every result must be grounded in a visible, audible, spoken, OCR, semantic, or game-event moment from the videos. "
        "Do not invent timestamps, clips, filenames, scores, players, or relevance."
    )


def jockey_search_prompt(game, query, limit, filter_key=None, video_name=None):
    parts = [
        f"Search this sports knowledge store for: {query}",
        f"Return up to {limit} ranked results.",
        "Each result must include the best available video_reference, timestamp, start_time, end_time, title, description, relevance, and confidence.",
        "Use timestamp/start_time/end_time as timecodes like M:SS or H:MM:SS. If the end time is not explicit, choose a short useful end time after the start.",
        "Use concise titles suitable for a search result card.",
        f"Game context: {game['label']} ({game['sport']}).",
        "Registered source videos: " + "; ".join(game.get("source_videos", [])),
    ]
    if video_name:
        parts.append(f"Search only this registered source video: {video_name}.")
    if filter_key:
        parts.append(JOCKEY_SEARCH_FILTER_PROMPTS[filter_key])
    parts.append("If no grounded matches exist, return total_results 0 and an empty results array.")
    return "\n".join(parts)


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


def normalize_jockey_search(game, query, search, limit):
    if not isinstance(search, dict):
        raise ApiError("TwelveLabs Jockey search response was not an object", 502)
    raw_results = search.get("results", [])
    if not isinstance(raw_results, list):
        raise ApiError("TwelveLabs Jockey search response results was not an array", 502)

    results = []
    for index, raw_result in enumerate(raw_results[:limit]):
        if not isinstance(raw_result, dict):
            continue
        normalized = normalize_jockey_search_result(game, raw_result, index)
        if normalized:
            results.append(normalized)

    return {
        "query": query,
        "query_interpretation": clean_optional_string(search.get("query_interpretation")) or query,
        "total_results": len(results),
        "results": results,
    }


def normalize_jockey_search_result(game, raw_result, index):
    reference = clean_optional_string(raw_result.get("video_reference"))
    description = clean_optional_string(raw_result.get("description"))
    relevance = clean_optional_string(raw_result.get("relevance"))
    if not reference or not description or not relevance:
        return None

    start_time = clean_optional_string(raw_result.get("start_time"))
    end_time = clean_optional_string(raw_result.get("end_time"))
    timestamp = clean_optional_string(raw_result.get("timestamp"))
    range_start, range_end = split_time_range(timestamp)
    start_time = start_time or range_start or timestamp
    end_time = end_time or range_end or default_end_time(start_time)
    title = clean_optional_string(raw_result.get("title")) or description[:80]
    video_name = video_name_for_reference(game, reference)
    confidence = raw_result.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = None

    return {
        "id": f"search-{index}-{sha256(json.dumps(raw_result, sort_keys=True, default=str).encode()).hexdigest()[:12]}",
        "video_reference": reference,
        "video_name": video_name,
        "timestamp": timestamp or start_time,
        "start_time": start_time,
        "end_time": end_time,
        "title": title,
        "description": description,
        "relevance": relevance,
        "confidence": confidence,
        "source_asset_id": asset_id_for_video_name(game, video_name) if video_name else None,
    }


def split_time_range(value):
    if not isinstance(value, str) or not value.strip():
        return None, None
    parts = re.split(r"\s*(?:-|–|—|to)\s*", value.strip(), maxsplit=1)
    if len(parts) != 2:
        return value.strip(), None
    return clean_optional_string(parts[0]), clean_optional_string(parts[1])


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


def should_refresh_reel_log_cache(payload):
    return any(
        bool(payload.get(key))
        for key in ("refresh", "force", "force_refresh", "force_regenerate", "ignore_log_cache")
    )


def highlight_reels_from_generated_log_cache(game, video_name, context_hash):
    log_cache = game.get(GENERATED_REEL_LOGS_FIELD, {})
    if not isinstance(log_cache, dict):
        return None
    log_name = log_cache.get(video_name)
    if not log_name:
        return None
    return generated_highlight_reels_from_log(log_name, video_name, context_hash)


def generated_highlight_reels_from_log(log_name, video_name, context_hash):
    path = highlight_log_path(log_name)
    if not path.exists():
        return None
    data = read_json(path)
    if data.get("type") != GENERATED_REEL_LOG_TYPE:
        return None
    if data.get("schema_version") != GENERATED_REEL_LOG_SCHEMA_VERSION:
        return None
    if data.get("model") != TWELVELABS_MODEL:
        return None
    if data.get("video_name") != video_name:
        return None
    if data.get("context_hash") != context_hash:
        return None

    reels = data.get("reels")
    if not is_complete_highlight_reels(reels):
        return None
    try:
        validate_highlight_confidences(reels, f"generated highlight response log {path.name}")
    except ApiError:
        return None
    return reels


def store_generated_highlight_reels_log_cache(tag, game, video_name, context_hash, reels):
    if not is_complete_highlight_reels(reels):
        return
    log_name = write_generated_highlight_reels_log(tag, video_name, context_hash, reels)
    path = game_path(tag)
    current_game = read_json(path) if path.exists() else deepcopy(game)
    log_cache = current_game.setdefault(GENERATED_REEL_LOGS_FIELD, {})
    if not isinstance(log_cache, dict):
        log_cache = {}
        current_game[GENERATED_REEL_LOGS_FIELD] = log_cache
    log_cache[video_name] = log_name
    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current_game, indent=2, ensure_ascii=False))


def write_generated_highlight_reels_log(tag, video_name, context_hash, reels):
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = timestamp()
    source_slug = slugify_filename(Path(video_name).stem)
    log_name = f"{generated_at}_{tag}_{source_slug}_generated_highlight_reels.json"
    body = {
        "type": GENERATED_REEL_LOG_TYPE,
        "schema_version": GENERATED_REEL_LOG_SCHEMA_VERSION,
        "generated_at": generated_at,
        "tag": tag,
        "video_name": video_name,
        "model": TWELVELABS_MODEL,
        "context_hash": context_hash,
        "reels": reels,
    }
    (LOGS_DIR / log_name).write_text(json.dumps(body, indent=2, ensure_ascii=False))
    return log_name


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


def highlight_cache_context_hash(match_context, wsc_baseline):
    body = json.dumps(
        {"match_context": match_context, "wsc_baseline": wsc_baseline},
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return sha256(body.encode()).hexdigest()


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


def twelvelabs_stream_info(tag, video_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    asset_id = twelvelabs_asset_id_for_video(game, video_name)
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
    return {
        "provider": "twelvelabs",
        "type": "hls",
        "asset_id": asset_id,
        "asset_status": asset.get("status"),
        "hls_status": hls_status,
        "manifest_url": manifest_url,
    }


def twelvelabs_asset_id_for_video(game, video_name):
    asset_ids = game.get("video_asset_ids", {})
    if isinstance(asset_ids, dict) and asset_ids.get(video_name):
        return asset_ids[video_name]

    if SPORTS_INGEST_STATE_PATH.exists():
        state = read_json(SPORTS_INGEST_STATE_PATH)
        asset_id = state.get("asset_ids", {}).get(video_name)
        if asset_id:
            return asset_id

    raise ApiError("TwelveLabs asset id not found for this video", 404)


def generated_reel_clip(tag, video_name, start, end, format_name, clip_name=None):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    source_path = registered_video_path(tag, video_name)
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
        f"{tag}|{video_name}|{start_seconds:.3f}|{end_seconds:.3f}|{format_key}".encode()
    ).hexdigest()[:16]
    output_path = REELS_DIR / (
        f"{source_slug}-{safe_label}-{format_key}-{int(start_seconds * 1000)}-{int(end_seconds * 1000)}-{cache_hash}.mp4"
    )
    if not output_path.exists():
        render_reel_clip(source_path, output_path, start_seconds, duration, reel_format)
    download_name = f"{source_slug}-{safe_label}-{reel_format['label'].replace(':', 'x')}-{int(start_seconds)}-{int(end_seconds)}.mp4"
    return output_path, download_name


def generated_reel_thumbnail(tag, video_name, time, format_name):
    game = get_game(tag)
    video_name = validate_registered_video_name(game, video_name, status_code=404)
    source_path = registered_video_path(tag, video_name)
    time_seconds = parse_reel_seconds(time, "time")
    format_key = (format_name or "9x16").strip()
    reel_format = REEL_FORMATS.get(format_key)
    if not reel_format:
        raise ApiError(f"unsupported reel format: {format_name}", 400)

    REEL_THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    source_slug = slugify_filename(Path(video_name).stem)
    cache_hash = sha256(
        f"{tag}|{video_name}|{time_seconds:.3f}|{format_key}|thumbnail".encode()
    ).hexdigest()[:16]
    output_path = REEL_THUMBNAILS_DIR / f"{source_slug}-{format_key}-{int(time_seconds * 1000)}-{cache_hash}.jpg"
    if not output_path.exists():
        render_reel_thumbnail(source_path, output_path, time_seconds, reel_format)
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


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def game_path(tag):
    return GAMES_DIR / f"{tag}.json"


def video_path(video_name):
    if Path(video_name).name != video_name:
        raise ApiError("video_name must be a file name", 400)
    return VIDEOS_DIR / video_name


def thumbnail_path(video_name):
    if Path(video_name).name != video_name:
        raise ApiError("video_name must be a file name", 400)
    return THUMBNAILS_DIR / f"{video_name}.jpg"


def highlight_log_path(log_name):
    if not isinstance(log_name, str) or not log_name.strip():
        raise ApiError("highlight_response_log must be a non-empty string", 400)
    clean_name = log_name.strip()
    if Path(clean_name).name != clean_name:
        raise ApiError("highlight_response_log must be a log file name", 400)
    return LOGS_DIR / clean_name


def validate_highlight_response_log(log_name):
    path = highlight_log_path(log_name)
    if not path.exists():
        raise ApiError(f"highlight response log not found: {path.name}", 400)
    reels = highlight_reels_from_log(path.name)
    if not HIGHLIGHT_RESPONSE_KEYS.issubset(reels.keys()):
        raise ApiError("highlight response log does not contain a complete highlight response", 400)
    return path.name


def validate_highlight_response_logs(logs, source_videos):
    if logs is None:
        return {}
    if not isinstance(logs, dict):
        raise ApiError("highlight_response_logs must be an object", 400)

    source_video_set = set(source_videos)
    validated = {}
    for video_name, log_name in logs.items():
        if not isinstance(video_name, str) or not video_name.strip():
            raise ApiError("highlight_response_logs keys must be source video names", 400)
        clean_video_name = video_name.strip()
        if clean_video_name not in source_video_set:
            raise ApiError(f"highlight_response_logs key is not a registered source video: {clean_video_name}", 400)
        validated[clean_video_name] = validate_highlight_response_log(log_name)
    return validated


def highlight_reels_from_log(log_name):
    path = highlight_log_path(log_name)
    if not path.exists():
        raise ApiError(f"pinned highlight response log not found: {path.name}", 500)
    data = read_json(path)
    if HIGHLIGHT_RESPONSE_KEYS.issubset(data.keys()):
        return data
    try:
        response = data["responses"]["game_highlight_reels"]
        if response["status_code"] >= 400:
            raise ApiError("pinned highlight response log contains a failed response", 500)
        reels = response["body"]
    except (KeyError, TypeError):
        raise ApiError("pinned highlight response log is not a supported response log", 500)
    if not isinstance(reels, dict) or not HIGHLIGHT_RESPONSE_KEYS.issubset(reels.keys()):
        raise ApiError("pinned highlight response log does not contain a complete highlight response", 500)
    validate_highlight_confidences(reels, f"pinned highlight response log {path.name}")
    return reels


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
