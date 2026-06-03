from flask import Blueprint, jsonify, request

from app.core.validation import json_body
from app.services.games import workspace_lookup_kwargs
from app.services.jockey_workspace_metadata import (
    append_saved_clip_analysis,
    append_saved_jockey_turn,
    append_saved_jockey_turns_for_exchange,
    get_jockey_workspace_metadata,
)


game_workspace_bp = Blueprint("game_workspace", __name__)


def workspace_request_lookup(body=None):
    lookup = workspace_lookup_kwargs(request.args.to_dict())
    if isinstance(body, dict):
        for key, value in workspace_lookup_kwargs(body).items():
            lookup.setdefault(key, value)
    return lookup


@game_workspace_bp.get("/games/<tag>/videos/<video_name>/jockey-workspace")
def show_jockey_workspace(tag, video_name):
    return jsonify(get_jockey_workspace_metadata(tag, video_name, lookup=workspace_request_lookup()))


@game_workspace_bp.post("/games/<tag>/videos/<video_name>/jockey-workspace/saved-clip-analysis")
def save_jockey_workspace_clip_analysis(tag, video_name):
    body = json_body()
    return jsonify(append_saved_clip_analysis(tag, video_name, body, lookup=workspace_request_lookup(body))), 201


@game_workspace_bp.post("/games/<tag>/videos/<video_name>/jockey-workspace/saved-jockey-turn")
def save_jockey_workspace_turn(tag, video_name):
    body = json_body()
    return jsonify(append_saved_jockey_turn(tag, video_name, body, lookup=workspace_request_lookup(body))), 201


@game_workspace_bp.post("/games/<tag>/jockey-workspace/saved-jockey-turn")
def save_jockey_workspace_turns(tag):
    return jsonify(append_saved_jockey_turns_for_exchange(tag, json_body())), 201
