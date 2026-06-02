from flask import Blueprint, jsonify

from app.core.validation import optional_json_body, uploaded_file
from app.services.assets import index_twelvelabs_asset, upload_twelvelabs_asset


assets_bp = Blueprint("assets", __name__)


@assets_bp.post("/assets")
def create_asset():
    return jsonify(upload_twelvelabs_asset(uploaded_file())), 201


@assets_bp.post("/assets/<asset_id>/index")
def index_asset(asset_id):
    return jsonify(index_twelvelabs_asset(asset_id, optional_json_body())), 202
