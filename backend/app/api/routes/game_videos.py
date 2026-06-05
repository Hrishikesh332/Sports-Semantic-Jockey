from flask import Blueprint, jsonify

from app.core.validation import uploaded_file
from app.services.games import (
    list_game_discover_videos,
    list_game_index_videos,
    queue_game_video_repair,
    upload_game_video,
)


game_videos_bp = Blueprint("game_videos", __name__)


@game_videos_bp.get("/games/<tag>/index-videos")
def show_game_index_videos(tag):
    response = jsonify(list_game_index_videos(tag))
    response.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=300"
    return response


@game_videos_bp.get("/games/<tag>/discover-videos")
def show_game_discover_videos(tag):
    return jsonify(list_game_discover_videos(tag))


@game_videos_bp.post("/games/<tag>/upload")
def upload_game_media(tag):
    return jsonify(upload_game_video(tag, uploaded_file())), 202


@game_videos_bp.post("/games/<tag>/videos/<video_name>/repair")
def repair_game_video_route(tag, video_name):
    return jsonify(queue_game_video_repair(tag, video_name)), 202
