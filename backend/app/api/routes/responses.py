from flask import Blueprint, jsonify

from app.core.validation import json_body
from app.integrations.twelvelabs import request_json


responses_bp = Blueprint("responses", __name__)


@responses_bp.post("/responses")
def create_response():
    result = request_json("post", "/responses", json_body())
    return jsonify(result)
