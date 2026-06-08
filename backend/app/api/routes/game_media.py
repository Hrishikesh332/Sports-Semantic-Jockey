from flask import Blueprint, jsonify, redirect, request

from app.api.media import (
    send_directory_path,
    send_jpeg_bytes,
    send_mp4_bytes,
    send_mp4_path,
    send_svg_text,
)
from app.core.errors import ApiError
from app.services.games import (
    THUMBNAILS_DIR,
    VIDEOS_DIR,
    assembly_reel_cache_status,
    generated_assembly_reel,
    generated_reel_clip,
    generated_reel_thumbnail,
    persist_remote_thumbnail,
    placeholder_thumbnail_svg,
    registered_indexed_thumbnail_url,
    registered_thumbnail_path_or_none,
    registered_video_path,
    twelvelabs_stream_info,
)


DEFAULT_ASSEMBLY_REEL_FORMAT = "16x9"
DEFAULT_REEL_FORMAT = "9x16"
THUMBNAIL_CACHE_SECONDS = 86400
STREAM_INFO_CACHE_SECONDS = 600

game_media_bp = Blueprint("game_media", __name__)


@game_media_bp.get("/games/<tag>/media/<video_name>")
def show_game_media(tag, video_name):
    path = registered_video_path(tag, video_name)
    return send_directory_path(VIDEOS_DIR, path)


@game_media_bp.get("/games/<tag>/stream/<video_name>")
def show_game_stream(tag, video_name):
    response = jsonify(twelvelabs_stream_info(tag, video_name, reference=stream_reference()))
    response.cache_control.private = True
    response.cache_control.max_age = STREAM_INFO_CACHE_SECONDS
    response.headers["Vary"] = "Origin"
    return response


@game_media_bp.get("/games/<tag>/reel/<video_name>")
def download_game_reel(tag, video_name):
    content, download_name = generated_reel_clip(**reel_clip_params(tag, video_name))
    return send_mp4_bytes(
        content,
        download_name=download_name,
        as_attachment=reel_download_enabled(),
    )


@game_media_bp.get("/games/<tag>/assembly-reel/<video_name>")
def show_game_assembly_reel(tag, video_name):
    path, download_name = generated_assembly_reel(**assembly_reel_params(tag, video_name))
    return send_mp4_path(
        path,
        download_name=download_name,
        as_attachment=assembly_download_enabled(),
    )


@game_media_bp.get("/games/<tag>/assembly-reel-status/<video_name>")
def show_game_assembly_reel_status(tag, video_name):
    path, _download_name, _segment_ranges, _reel_format, _stream_info = assembly_reel_cache_status(
        **assembly_reel_params(tag, video_name)
    )
    exists = path.exists()
    query = request.query_string.decode("utf-8")
    url = f"/games/{quote_path_segment(tag)}/assembly-reel/{quote_path_segment(video_name)}"
    if query:
        url = f"{url}?{query}"
    return jsonify({"exists": exists, "url": url if exists else None})


@game_media_bp.get("/games/<tag>/reel-thumbnail/<video_name>")
def show_game_reel_thumbnail(tag, video_name):
    try:
        content = generated_reel_thumbnail(**reel_thumbnail_params(tag, video_name))
        return send_jpeg_bytes(content)
    except ApiError as exc:
        if exc.status_code != 404:
            raise
        return placeholder_thumbnail_response(tag, video_name)


@game_media_bp.get("/games/<tag>/thumbnail/<video_name>")
def show_game_thumbnail(tag, video_name):
    path = registered_thumbnail_path_or_none(tag, video_name)
    if path:
        return stored_thumbnail_response(path)

    remote_url = registered_indexed_thumbnail_url(tag, video_name)
    if remote_url:
        cached_path = persist_remote_thumbnail(video_name, remote_url)
        if cached_path:
            return stored_thumbnail_response(cached_path)
        return redirect(remote_url)

    return placeholder_thumbnail_response(tag, video_name)


def assembly_download_enabled():
    return request.args.get("download", "0") == "1"


def assembly_reel_params(tag, video_name):
    return {
        "tag": tag,
        "video_name": video_name,
        "segments": request.args.get("segments"),
        "format_name": request.args.get("format", DEFAULT_ASSEMBLY_REEL_FORMAT),
        "assembly_name": request.args.get("name"),
        "reference": stream_reference(),
    }


def quote_path_segment(value):
    from urllib.parse import quote

    return quote(value, safe="")


def placeholder_thumbnail_response(tag, video_name):
    return send_svg_text(placeholder_thumbnail_svg(tag, video_name))


def reel_clip_params(tag, video_name):
    return {
        "tag": tag,
        "video_name": video_name,
        "start": request.args.get("start"),
        "end": request.args.get("end"),
        "format_name": request.args.get("format", DEFAULT_REEL_FORMAT),
        "clip_name": request.args.get("name"),
    }


def reel_download_enabled():
    return request.args.get("download", "1") != "0"


def reel_thumbnail_params(tag, video_name):
    return {
        "tag": tag,
        "video_name": video_name,
        "time": request.args.get("time"),
        "format_name": request.args.get("format", DEFAULT_REEL_FORMAT),
    }


def stored_thumbnail_response(path):
    return send_directory_path(THUMBNAILS_DIR, path, max_age=THUMBNAIL_CACHE_SECONDS)


def stream_reference():
    return request.args.get("reference") or request.args.get("asset_id")
