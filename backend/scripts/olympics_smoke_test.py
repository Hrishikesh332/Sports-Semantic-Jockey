import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VIDEOS = [ROOT / "data/videos/Olympics 13.mp4", ROOT / "data/videos/Olympics 14.mp4"]
GAME_TAG = "olympics-smoke"
sys.path.insert(0, str(ROOT))

from app import app
from app.domain.highlights import SPORTS_HIGHLIGHT_INGESTION_SCHEMA


def load_env(path):
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def call_json(client, method, path, **kwargs):
    response = getattr(client, method)(path, **kwargs)
    body = response.get_json(silent=True)
    data = {"status_code": response.status_code, "body": body}
    return response.status_code, body, data


def wait_for_item(client, store_id, item_id):
    attempts = []
    for _ in range(90):
        status_code, body, data = call_json(client, "get", f"/knowledge-stores/{store_id}/items/{item_id}")
        attempts.append(data)
        if status_code >= 400:
            return body, attempts
        status = body.get("status")
        if status in {"ready", "failed"}:
            return body, attempts
        time.sleep(10)
    return {"_id": item_id, "status": "timeout"}, attempts


def main():
    load_env(ROOT / ".env")
    client = app.test_client()
    summary = []
    raw = {"videos": [str(video) for video in VIDEOS], "responses": {}}

    status_code, store, data = call_json(
        client,
        "post",
        "/knowledge-stores",
        json={
            "name": f"Olympics Highlight Smoke {timestamp()}",
            "ingestion_config": {
                "enrichment_config": {
                    "type": "json_schema",
                    "json_schema": SPORTS_HIGHLIGHT_INGESTION_SCHEMA,
                }
            },
        },
    )
    raw["responses"]["create_store"] = data
    summary.append(["POST /knowledge-stores", status_code, brief(store)])
    if status_code >= 400:
        return finish(summary, raw)

    store_id = store["_id"]
    asset_ids = []
    upload_responses = []
    for video in VIDEOS:
        with video.open("rb") as handle:
            status_code, asset, data = call_json(
                client,
                "post",
                "/assets",
                data={"method": "direct", "file": (handle, video.name)},
                content_type="multipart/form-data",
            )
        upload_responses.append(data)
        summary.append(["POST /assets", status_code, brief(asset)])
        if status_code >= 400:
            raw["responses"]["upload_assets"] = upload_responses
            return finish(summary, raw)
        asset_ids.append(asset["_id"])
    raw["responses"]["upload_assets"] = upload_responses

    item_responses = []
    item_bodies = []
    for asset_id in asset_ids:
        status_code, item, data = call_json(
            client,
            "post",
            f"/knowledge-stores/{store_id}/items",
            json={"asset_id": asset_id},
        )
        item_responses.append(data)
        item_bodies.append(item)
        summary.append([f"POST /knowledge-stores/{store_id}/items", status_code, brief(item)])
        if status_code >= 400:
            raw["responses"]["add_items"] = item_responses
            return finish(summary, raw)
    raw["responses"]["add_items"] = item_responses

    item_statuses = []
    item_poll_responses = {}
    for item in item_bodies:
        item_id = item["_id"]
        final_item, attempts = wait_for_item(client, store_id, item_id)
        item_statuses.append(final_item)
        item_poll_responses[item_id] = attempts
        summary.append([f"GET /knowledge-stores/{store_id}/items/{item_id}", attempts[-1]["status_code"], brief(final_item)])
    raw["responses"]["poll_items"] = item_poll_responses

    if any(item.get("status") != "ready" for item in item_statuses):
        return finish(summary, raw)

    status_code, game, data = call_json(
        client,
        "post",
        "/games",
        json={
            "tag": GAME_TAG,
            "label": "Olympics Smoke Test",
            "sport": "Olympics",
            "knowledge_store_id": store_id,
            "source_videos": [video.name for video in VIDEOS],
            "video_reference_map": video_reference_map(item_bodies),
        },
    )
    raw["responses"]["register_game"] = data
    summary.append(["POST /games", status_code, brief(game)])
    if status_code >= 400:
        return finish(summary, raw)

    status_code, games, data = call_json(client, "get", "/games")
    raw["responses"]["list_games"] = data
    summary.append(["GET /games", status_code, brief(games)])
    if status_code >= 400:
        return finish(summary, raw)

    status_code, game, data = call_json(client, "get", f"/games/{GAME_TAG}")
    raw["responses"]["get_game"] = data
    summary.append([f"GET /games/{GAME_TAG}", status_code, brief(game)])
    if status_code >= 400:
        return finish(summary, raw)

    media_response = client.get(f"/games/{GAME_TAG}/media/{VIDEOS[0].name}", headers={"Range": "bytes=0-1023"})
    raw["responses"]["game_media"] = {
        "status_code": media_response.status_code,
        "content_type": media_response.content_type,
        "content_length": media_response.content_length,
    }
    summary.append(
        [
            f"GET /games/{GAME_TAG}/media/{VIDEOS[0].name}",
            media_response.status_code,
            {
                "content_type": media_response.content_type,
                "content_length": media_response.content_length,
            },
        ]
    )
    if media_response.status_code >= 400:
        return finish(summary, raw)

    status_code, reels, data = call_json(
        client,
        "post",
        f"/games/{GAME_TAG}/highlight-reels",
        json={"match_context": "Olympics sample videos provided by the user for sports highlight generation testing."},
    )
    raw["responses"]["game_highlight_reels"] = data
    summary.append([f"POST /games/{GAME_TAG}/highlight-reels", status_code, brief_highlight_reels(reels)])
    return finish(summary, raw)


def brief(body):
    if not isinstance(body, dict):
        return str(body)
    keys = ["_id", "id", "status", "filename", "match_summary", "error"]
    picked = {key: body[key] for key in keys if key in body}
    if "items" in body:
        picked["items_count"] = len(body["items"])
    if "games" in body:
        picked["games_count"] = len(body["games"])
    return picked


def video_reference_map(item_bodies):
    mapping = {}
    for item, video in zip(item_bodies, VIDEOS):
        item_id = item["_id"]
        mapping[item_id] = video.name
        if item_id.startswith("ksi_"):
            mapping[item_id.removeprefix("ksi_")] = video.name
    return mapping


def brief_highlight_reels(body):
    if not isinstance(body, dict):
        return str(body)
    picked = {key: body[key] for key in ["match_summary", "error"] if key in body}
    categories = ["standard_stats", "best_plays", "emotional_moments", "fan_experience", "behind_the_scenes"]
    picked["categories"] = [
        {"id": category, "clips": len(body.get(category, {}).get("clips", []))}
        for category in categories
        if category in body
    ]
    return picked


def finish(summary, raw):
    print(json.dumps({"summary": summary}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
