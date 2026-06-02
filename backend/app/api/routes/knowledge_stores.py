from flask import Blueprint, jsonify

from app.core.validation import json_body
from app.services.knowledge_stores import (
    create_knowledge_store_from_payload,
    create_knowledge_store_item_from_payload,
    fetch_knowledge_store_item,
)


knowledge_stores_bp = Blueprint("knowledge_stores", __name__)


@knowledge_stores_bp.post("/knowledge-stores")
def create_knowledge_store():
    return jsonify(create_knowledge_store_from_payload(json_body())), 201


@knowledge_stores_bp.post("/knowledge-stores/<store_id>/items")
def create_knowledge_store_item(store_id):
    return jsonify(create_knowledge_store_item_from_payload(store_id, json_body())), 201


@knowledge_stores_bp.get("/knowledge-stores/<store_id>/items/<item_id>")
def get_knowledge_store_item(store_id, item_id):
    return jsonify(fetch_knowledge_store_item(store_id, item_id))
