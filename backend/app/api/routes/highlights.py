from flask import Blueprint, jsonify

from app.core.validation import json_body, optional_string, required_string
from app.services.highlights import generate_highlight_reels


highlights_bp = Blueprint("highlights", __name__)


@highlights_bp.post("/highlight-reels")
def create_highlight_reels():
    body = json_body()
    reels = generate_highlight_reels(
        knowledge_store_id=required_string(body, "knowledge_store_id"),
        match_context=optional_string(body, "match_context"),
        wsc_baseline=body.get("wsc_baseline"),
    )
    return jsonify(reels)
