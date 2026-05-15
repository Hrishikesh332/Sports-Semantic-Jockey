from flask import Blueprint, jsonify

from app.core.validation import json_body, required_dict, required_string, required_string_dict
from app.integrations.twelvelabs import request_json


knowledge_stores_bp = Blueprint("knowledge_stores", __name__)


@knowledge_stores_bp.post("/knowledge-stores")
def create_knowledge_store():
    body = json_body()
    payload = {"name": required_string(body, "name")}
    if "ingestion_config" in body:
        payload["ingestion_config"] = required_dict(body, "ingestion_config")
    if "metadata" in body:
        payload["metadata"] = required_string_dict(body, "metadata")
    store = request_json("post", "/knowledge-stores", payload)
    return jsonify(store), 201


@knowledge_stores_bp.post("/knowledge-stores/<store_id>/items")
def create_knowledge_store_item(store_id):
    body = json_body()
    item = request_json(
        "post",
        f"/knowledge-stores/{store_id}/items",
        {"asset_id": required_string(body, "asset_id")},
    )
    return jsonify(item), 201


@knowledge_stores_bp.get("/knowledge-stores/<store_id>/items/<item_id>")
def get_knowledge_store_item(store_id, item_id):
    item = request_json("get", f"/knowledge-stores/{store_id}/items/{item_id}")
    return jsonify(item)
