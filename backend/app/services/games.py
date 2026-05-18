import json
import re
import subprocess
from hashlib import sha256
from copy import deepcopy
from pathlib import Path

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


def list_games():
    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    games = [read_json(path) for path in sorted(GAMES_DIR.glob("*.json"))]
    return {"games": games}


def get_game(tag):
    path = game_path(tag)
    if not path.exists():
        raise ApiError("game not found", 404)
    return read_json(path)


def register_game(payload):
    tag = required_payload_string(payload, "tag")
    if not TAG_PATTERN.match(tag):
        raise ApiError("tag must be lowercase letters, numbers, and hyphens", 400)

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

    if "wsc_baseline" in payload:
        game["wsc_baseline"] = payload["wsc_baseline"]
    if "highlight_response_log" in payload:
        game["highlight_response_log"] = validate_highlight_response_log(payload["highlight_response_log"])
    highlight_response_logs = validate_highlight_response_logs(payload.get("highlight_response_logs", {}), source_videos)
    if highlight_response_logs:
        game["highlight_response_logs"] = highlight_response_logs

    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    game_path(tag).write_text(json.dumps(game, indent=2, ensure_ascii=False))
    return game


def generate_game_highlight_reels(tag, payload=None):
    game = get_game(tag)
    payload = payload or {}
    requested_video = payload.get("video_name") or payload.get("source_video")
    if requested_video:
        video_name = validate_registered_video_name(game, requested_video)
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

    match_context = payload.get("match_context") or scoped_match_context(game, requested_video)
    wsc_baseline = payload.get("wsc_baseline", game.get("wsc_baseline"))
    return generate_highlight_reels(
        knowledge_store_id=game["knowledge_store_id"],
        match_context=match_context,
        wsc_baseline=wsc_baseline,
    )


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
    if not isinstance(reference, str):
        return None
    source_videos = set(game.get("source_videos", []))
    return game.get("video_reference_map", {}).get(reference) or (reference if reference in source_videos else None)


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


def required_payload_string(payload, key):
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{key} is required", 400)
    return value.strip()


def read_json(path):
    return json.loads(path.read_text())
