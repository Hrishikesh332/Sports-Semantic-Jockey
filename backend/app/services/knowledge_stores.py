from app.core.validation import required_dict, required_string, required_string_dict
from app.integrations.twelvelabs import add_knowledge_store_item
from app.integrations.twelvelabs import create_knowledge_store as twelvelabs_create_knowledge_store
from app.integrations.twelvelabs import get_knowledge_store_item as twelvelabs_get_knowledge_store_item


def create_knowledge_store_from_payload(body):
    payload = {"name": required_string(body, "name")}
    if "ingestion_config" in body:
        payload["ingestion_config"] = required_dict(body, "ingestion_config")
    if "metadata" in body:
        payload["metadata"] = required_string_dict(body, "metadata")

    return twelvelabs_create_knowledge_store(
        name=payload["name"],
        ingestion_config=payload.get("ingestion_config"),
        metadata=payload.get("metadata"),
    )


def create_knowledge_store_item_from_payload(store_id, body):
    return add_knowledge_store_item(store_id, required_string(body, "asset_id"))


def fetch_knowledge_store_item(store_id, item_id):
    return twelvelabs_get_knowledge_store_item(store_id, item_id)
