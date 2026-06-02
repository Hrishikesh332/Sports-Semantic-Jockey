from app.core.config import twelvelabs_index_id
from app.core.errors import ApiError
from app.integrations.twelvelabs import add_indexed_asset, upload_asset


def upload_twelvelabs_asset(file):
    return upload_asset(file)


def index_twelvelabs_asset(asset_id, payload=None):
    clean_asset_id = asset_id.strip()
    if not clean_asset_id:
        raise ApiError("asset_id is required", 400)

    index_id = twelvelabs_index_id()
    if not index_id:
        raise ApiError("INDEX_ID is required", 500)

    enable_video_stream = True
    if isinstance(payload, dict) and "enable_video_stream" in payload:
        enable_video_stream = bool(payload["enable_video_stream"])

    indexed_asset = add_indexed_asset(index_id, clean_asset_id, enable_video_stream=enable_video_stream)
    return {
        "status": "indexing",
        "asset_id": clean_asset_id,
        "index_configured": True,
        "indexed_asset": indexed_asset,
    }
