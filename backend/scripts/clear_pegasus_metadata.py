#!/usr/bin/env python3
"""Remove cached Pegasus highlight metadata from TwelveLabs indexed assets."""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.integrations.twelvelabs import get_indexed_asset as twelvelabs_get_indexed_asset
from app.integrations.twelvelabs import update_indexed_asset_user_metadata
from app.services.games import (
    INDEX_VIDEOS_CACHE,
    INDEX_VIDEOS_CACHE_LOCK,
    configured_search_index_id,
    get_game,
    indexed_asset_user_metadata,
    list_indexed_assets,
    response_id,
)

PEGASUS_METADATA_PREFIX = "sports_jockey_pegasus"


def load_env(path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        import os

        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def pegasus_metadata_keys(metadata):
    if not isinstance(metadata, dict):
        return []
    return sorted(key for key in metadata if key.startswith(PEGASUS_METADATA_PREFIX))


def pegasus_metadata_deletion_payload(metadata):
    keys = pegasus_metadata_keys(metadata)
    if not keys:
        return None
    return {"user_metadata": {key: None for key in keys}}


def clear_pegasus_metadata(tag):
    game = get_game(tag)
    index_id = configured_search_index_id(game)
    cleared = []
    failed = []

    for indexed_asset in list_indexed_assets(index_id):
        indexed_asset_id = response_id(indexed_asset)
        if not indexed_asset_id:
            continue

        hydrated = twelvelabs_get_indexed_asset(index_id, indexed_asset_id)
        metadata = indexed_asset_user_metadata(hydrated)
        keys = pegasus_metadata_keys(metadata)
        if not keys:
            continue

        label = (
            hydrated.get("filename")
            or hydrated.get("name")
            or indexed_asset_id
        )
        payload = pegasus_metadata_deletion_payload(metadata)
        update_indexed_asset_user_metadata(index_id, indexed_asset_id, payload["user_metadata"])
        verify = indexed_asset_user_metadata(
            twelvelabs_get_indexed_asset(index_id, indexed_asset_id)
        )
        remaining = pegasus_metadata_keys(verify)
        if remaining:
            failed.append({"video": label, "remaining_keys": remaining})
        else:
            cleared.append({"video": label, "removed_keys": keys})

    with INDEX_VIDEOS_CACHE_LOCK:
        INDEX_VIDEOS_CACHE.pop(tag, None)

    return {"tag": tag, "index_id": index_id, "cleared": cleared, "failed": failed}


def main():
    parser = argparse.ArgumentParser(description="Clear Pegasus cached metadata from indexed assets.")
    parser.add_argument("--tag", default="sports")
    args = parser.parse_args()
    load_env(ROOT / ".env")
    result = clear_pegasus_metadata(args.tag)
    print(f"index_id={result['index_id']}")
    print(f"cleared={len(result['cleared'])} failed={len(result['failed'])}")
    for entry in result["cleared"]:
        print(f"  cleared: {entry['video']} ({len(entry['removed_keys'])} keys)")
    for entry in result["failed"]:
        print(f"  FAILED: {entry['video']} remaining={entry['remaining_keys']}")
    if result["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
