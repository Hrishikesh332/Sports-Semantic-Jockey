from flask import Blueprint, jsonify

from app.core.validation import json_body
from app.services.responses import create_twelvelabs_response


responses_bp = Blueprint("responses", __name__)


@responses_bp.post("/responses")
def create_response():
    return jsonify(create_twelvelabs_response(json_body()))
