from flask import Blueprint, jsonify

from app.core.validation import json_body
from app.services.ingestion import run_ingestion


ingestions_bp = Blueprint("ingestions", __name__)


@ingestions_bp.post("/ingestions")
def create_ingestion():
    result = run_ingestion(json_body())
    status_code = 201 if result["status"] == "ready" else 202
    return jsonify(result), status_code
