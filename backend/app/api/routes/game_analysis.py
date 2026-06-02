from flask import Blueprint, jsonify

from app.core.validation import json_body
from app.services.games import (
    create_entity_tracking_response,
    create_jockey_chat_response,
    create_selected_clip_analysis,
    generate_game_highlight_reels,
    search_game_videos,
)


game_analysis_bp = Blueprint("game_analysis", __name__)


@game_analysis_bp.post("/games/<tag>/highlight-reels")
def create_game_highlight_reels(tag):
    return jsonify(generate_game_highlight_reels(tag, json_body()))


@game_analysis_bp.post("/games/<tag>/search")
def search_game(tag):
    return jsonify(search_game_videos(tag, json_body()))


@game_analysis_bp.post("/games/<tag>/jockey-chat")
def jockey_chat(tag):
    return jsonify(create_jockey_chat_response(tag, json_body()))


@game_analysis_bp.post("/games/<tag>/clip-analysis")
def selected_clip_analysis(tag):
    return jsonify(create_selected_clip_analysis(tag, json_body()))


@game_analysis_bp.post("/games/<tag>/entity-tracking")
def entity_tracking(tag):
    return jsonify(create_entity_tracking_response(tag, json_body()))
