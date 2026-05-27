from flask import Blueprint, jsonify, request

from app.core.config import twelvelabs_index_id
from app.core.errors import ApiError
from app.core.validation import uploaded_file
from app.integrations.twelvelabs import request_json, upload_asset


assets_bp = Blueprint("assets", __name__)


@assets_bp.post("/assets")
def create_asset():
    asset = upload_asset(uploaded_file())
    return jsonify(asset), 201


@assets_bp.post("/assets/<asset_id>/index")
def index_asset(asset_id):
    clean_asset_id = asset_id.strip()
    if not clean_asset_id:
        raise ApiError("asset_id is required", 400)

    index_id = twelvelabs_index_id()
    if not index_id:
        raise ApiError("INDEX_ID is required", 500)

    body = request.get_json(silent=True)
    enable_video_stream = True
    if isinstance(body, dict) and "enable_video_stream" in body:
        enable_video_stream = bool(body["enable_video_stream"])

    indexed_asset = request_json(
        "post",
        f"/indexes/{index_id}/indexed-assets",
        {"asset_id": clean_asset_id, "enable_video_stream": enable_video_stream},
    )
    return jsonify(
        {
            "status": "indexing",
            "asset_id": clean_asset_id,
            "index_configured": True,
            "indexed_asset": indexed_asset,
        }
    ), 202
