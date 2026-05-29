from flask import Blueprint, Response, jsonify, request, send_file, send_from_directory

from app.core.errors import ApiError
from app.core.validation import json_body, uploaded_file
from app.services.games import (
    THUMBNAILS_DIR,
    VIDEOS_DIR,
    generated_reel_clip,
    generated_reel_thumbnail,
    generate_game_highlight_reels,
    create_jockey_chat_response,
    get_game,
    list_game_index_videos,
    list_games,
    public_game,
    register_game,
    placeholder_thumbnail_svg,
    registered_thumbnail_path_or_none,
    registered_video_path,
    search_game_videos,
    twelvelabs_stream_info,
    upload_game_video,
)


games_bp = Blueprint("games", __name__)


@games_bp.get("/games")
def index_games():
    return jsonify(list_games())


@games_bp.post("/games")
def create_game():
    game = register_game(json_body())
    return jsonify(public_game(game)), 201


@games_bp.get("/games/<tag>")
def show_game(tag):
    return jsonify(public_game(get_game(tag)))


@games_bp.get("/games/<tag>/index-videos")
def show_game_index_videos(tag):
    return jsonify(list_game_index_videos(tag))


@games_bp.post("/games/<tag>/highlight-reels")
def create_game_highlight_reels(tag):
    reels = generate_game_highlight_reels(tag, json_body())
    return jsonify(reels)


@games_bp.post("/games/<tag>/search")
def search_game(tag):
    results = search_game_videos(tag, json_body())
    return jsonify(results)


@games_bp.post("/games/<tag>/upload")
def upload_game_media(tag):
    result = upload_game_video(tag, uploaded_file())
    return jsonify(result), 202


@games_bp.post("/games/<tag>/jockey-chat")
def jockey_chat(tag):
    result = create_jockey_chat_response(tag, json_body())
    return jsonify(result)


@games_bp.get("/games/<tag>/media/<video_name>")
def show_game_media(tag, video_name):
    path = registered_video_path(tag, video_name)
    return send_from_directory(VIDEOS_DIR, path.name)


@games_bp.get("/games/<tag>/stream/<video_name>")
def show_game_stream(tag, video_name):
    return jsonify(twelvelabs_stream_info(tag, video_name))


@games_bp.get("/games/<tag>/reel/<video_name>")
def download_game_reel(tag, video_name):
    path, download_name = generated_reel_clip(
        tag=tag,
        video_name=video_name,
        start=request.args.get("start"),
        end=request.args.get("end"),
        format_name=request.args.get("format", "9x16"),
        clip_name=request.args.get("name"),
    )
    return send_file(
        path,
        mimetype="video/mp4",
        as_attachment=request.args.get("download", "1") != "0",
        download_name=download_name,
    )


@games_bp.get("/games/<tag>/reel-thumbnail/<video_name>")
def show_game_reel_thumbnail(tag, video_name):
    try:
        path = generated_reel_thumbnail(
            tag=tag,
            video_name=video_name,
            time=request.args.get("time"),
            format_name=request.args.get("format", "9x16"),
        )
        return send_file(path, mimetype="image/jpeg")
    except ApiError as exc:
        if exc.status_code != 404:
            raise
        return Response(placeholder_thumbnail_svg(tag, video_name), mimetype="image/svg+xml")


@games_bp.get("/games/<tag>/thumbnail/<video_name>")
def show_game_thumbnail(tag, video_name):
    path = registered_thumbnail_path_or_none(tag, video_name)
    if path:
        return send_from_directory(THUMBNAILS_DIR, path.name)
    return Response(placeholder_thumbnail_svg(tag, video_name), mimetype="image/svg+xml")
