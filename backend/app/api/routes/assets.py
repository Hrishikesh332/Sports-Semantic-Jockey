from flask import Blueprint, jsonify

from app.core.validation import uploaded_file
from app.integrations.twelvelabs import upload_asset


assets_bp = Blueprint("assets", __name__)


@assets_bp.post("/assets")
def create_asset():
    asset = upload_asset(uploaded_file())
    return jsonify(asset), 201
