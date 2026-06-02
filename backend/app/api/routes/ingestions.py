from flask import Blueprint, jsonify

from app.core.validation import json_body
from app.services.ingestion import run_ingestion


ingestions_bp = Blueprint("ingestions", __name__)


@ingestions_bp.post("/ingestions")
def create_ingestion():
    result = run_ingestion(json_body())
    if result["status"] == "ready":
        return jsonify(result), 201
    return jsonify(result), 202
