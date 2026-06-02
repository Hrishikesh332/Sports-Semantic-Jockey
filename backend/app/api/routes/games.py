from flask import Blueprint, jsonify

from app.core.validation import json_body
from app.services.games import (
    get_game,
    list_games,
    public_game,
    register_game,
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
