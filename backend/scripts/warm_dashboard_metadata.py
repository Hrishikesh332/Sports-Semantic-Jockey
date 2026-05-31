#!/usr/bin/env python3
"""Warm Dashboard highlight reels + entity tracking metadata for every indexed video.

Uses existing backend endpoints only:
  GET  /games/<tag>/index-videos
  POST /games/<tag>/highlight-reels  (include_entity_tracking=true)

Requires the Flask backend to be running (default http://127.0.0.1:5000).

Example:
  cd backend && python wsgi.py

  python3 scripts/warm_dashboard_metadata.py --tag sports

  python3 scripts/warm_dashboard_metadata.py --tag sports --force

  python3 scripts/warm_dashboard_metadata.py --tag sports --video "Kansas vs Baylor Feb 26 2022.mp4"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOG = ROOT / "logs" / "dashboard_metadata_warm.log"
DEFAULT_STATE = ROOT / "data" / "dashboard_metadata_warm_state.json"
DEFAULT_BASE = os.environ.get("SPORTS_JOCKEY_API", "http://127.0.0.1:5000")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


class Logger:
    def __init__(self, log_path: Path):
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, message: str) -> None:
        line = f"[{utc_now()}] {message}"
        print(line, flush=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def request_json(method: str, url: str, payload: dict | None = None, timeout: int = 900) -> tuple[int, dict]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return response.status, json.loads(body) if body else {}


def workspace_video_name(video: dict) -> str:
    for key in ("source_video_name", "metadata_source_video_name", "display_name", "name"):
        value = video.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    indexed_asset_id = video.get("indexed_asset_id")
    if isinstance(indexed_asset_id, str) and indexed_asset_id.strip():
        return indexed_asset_id.strip()
    asset_id = video.get("asset_id")
    if isinstance(asset_id, str) and asset_id.strip():
        return asset_id.strip()
    return str(video.get("id") or "unknown-video")


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"videos": {}, "updated_at": None}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {"videos": {}, "updated_at": None}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = utc_now()
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def highlight_provenance(body: dict) -> dict:
    if "highlight_reels" in body:
        meta = body["highlight_reels"].get("_pegasus_metadata") or {}
    else:
        meta = body.get("_pegasus_metadata") or {}
    return {
        "source": meta.get("source"),
        "from_user_metadata": bool(meta.get("from_user_metadata")),
        "generated_at": meta.get("generated_at"),
        "clip_counts": meta.get("clip_counts"),
    }


def entity_provenance(body: dict) -> dict:
    entity = body.get("entity_tracking") or {}
    meta = entity.get("_jockey_metadata") or {}
    return {
        "source": meta.get("source"),
        "from_user_metadata": bool(meta.get("from_user_metadata")),
        "generated_at": meta.get("generated_at"),
        "entity_count": meta.get("entity_count"),
    }


def needs_work(video: dict, force: bool) -> bool:
    if force:
        return True
    return not (
        video.get("has_jockey_highlight_metadata")
        and video.get("has_jockey_entity_tracking_metadata")
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Warm Dashboard metadata for all indexed videos.")
    parser.add_argument("--tag", default="sports")
    parser.add_argument("--base-url", default=DEFAULT_BASE)
    parser.add_argument("--timeout", type=int, default=900, help="Per-video request timeout in seconds")
    parser.add_argument("--force", action="store_true", help="Regenerate even when metadata already exists")
    parser.add_argument("--video", action="append", default=[], help="Process only these source video names")
    parser.add_argument("--log-file", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--skip-completed", action="store_true", default=True, help=argparse.SUPPRESS)
    parser.add_argument("--no-skip-completed", dest="skip_completed", action="store_false")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env(ROOT / ".env")
    logger = Logger(args.log_file)
    state = load_state(args.state_file)
    base = args.base_url.rstrip("/")
    tag = args.tag

    logger.write(f"dashboard metadata warm start tag={tag} base={base} force={args.force}")

    try:
        status, index_body = request_json("GET", f"{base}/games/{quote(tag, safe='')}/index-videos", timeout=120)
    except (HTTPError, URLError, TimeoutError) as error:
        logger.write(f"FAILED to load index videos: {error}")
        logger.write("Start the backend first: cd backend && python wsgi.py")
        return 1

    if status != 200:
        logger.write(f"FAILED index-videos HTTP {status}")
        return 1

    videos = index_body.get("index_videos") or []
    if not isinstance(videos, list) or not videos:
        logger.write("No index videos returned; nothing to warm.")
        return 0

    try:
        _, game_body = request_json("GET", f"{base}/games/{quote(tag, safe='')}", timeout=60)
    except (HTTPError, URLError, TimeoutError) as error:
        logger.write(f"FAILED to load game registration: {error}")
        return 1
    registered_videos = set(game_body.get("source_videos") or [])

    selected_names = {name.strip() for name in args.video if name.strip()}
    planned = []
    for video in videos:
        if not isinstance(video, dict):
            continue
        name = workspace_video_name(video)
        if selected_names and name not in selected_names:
            continue
        if registered_videos and name not in registered_videos:
            logger.write(f"SKIP {name}: indexed in TwelveLabs but not registered in game source_videos")
            continue
        if not video.get("asset_id"):
            logger.write(f"SKIP {name}: missing asset_id in index-videos")
            continue
        if not needs_work(video, args.force):
            logger.write(f"SKIP {name}: highlight + entity metadata already present")
            state["videos"][name] = {
                **state["videos"].get(name, {}),
                "status": "skipped_cached",
                "video_name": name,
                "indexed_asset_id": video.get("indexed_asset_id"),
                "asset_id": video.get("asset_id"),
                "finished_at": utc_now(),
            }
            continue
        if args.skip_completed and not args.force:
            prior = state["videos"].get(name, {})
            if prior.get("status") == "completed":
                logger.write(f"SKIP {name}: already completed in state file")
                continue
        planned.append((name, video))

    logger.write(f"planned={len(planned)} total_index_videos={len(videos)}")

    summary = {
        "completed": 0,
        "failed": 0,
        "skipped": len(videos) - len(planned),
    }

    for index, (name, video) in enumerate(planned, start=1):
        payload = {
            "video_name": name,
            "asset_id": video.get("asset_id"),
            "indexed_asset_id": video.get("indexed_asset_id"),
            "include_entity_tracking": True,
        }
        if args.force:
            payload["force_generate"] = True

        logger.write(
            f"[{index}/{len(planned)}] START {name} "
            f"asset_id={video.get('asset_id')} indexed_asset_id={video.get('indexed_asset_id')}"
        )
        started = time.time()
        entry = {
            "status": "running",
            "video_name": name,
            "asset_id": video.get("asset_id"),
            "indexed_asset_id": video.get("indexed_asset_id"),
            "started_at": utc_now(),
        }
        state["videos"][name] = entry
        save_state(args.state_file, state)

        try:
            status, body = request_json(
                "POST",
                f"{base}/games/{quote(tag, safe='')}/highlight-reels",
                payload=payload,
                timeout=args.timeout,
            )
            elapsed = round(time.time() - started, 1)
            if status != 200:
                raise RuntimeError(f"HTTP {status}: {body}")

            highlight = highlight_provenance(body)
            entity = entity_provenance(body)
            entry.update(
                {
                    "status": "completed",
                    "elapsed_seconds": elapsed,
                    "finished_at": utc_now(),
                    "highlight": highlight,
                    "entity_tracking": entity,
                }
            )
            state["videos"][name] = entry
            save_state(args.state_file, state)
            summary["completed"] += 1
            logger.write(
                f"[{index}/{len(planned)}] OK {name} elapsed={elapsed}s "
                f"highlight={highlight.get('source')} cached={highlight.get('from_user_metadata')} "
                f"entity={entity.get('source')} cached={entity.get('from_user_metadata')} "
                f"entities={entity.get('entity_count')}"
            )
        except Exception as error:
            elapsed = round(time.time() - started, 1)
            entry.update(
                {
                    "status": "failed",
                    "elapsed_seconds": elapsed,
                    "finished_at": utc_now(),
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                }
            )
            state["videos"][name] = entry
            save_state(args.state_file, state)
            summary["failed"] += 1
            logger.write(f"[{index}/{len(planned)}] FAILED {name} elapsed={elapsed}s error={error}")

    logger.write(
        f"dashboard metadata warm finished completed={summary['completed']} "
        f"failed={summary['failed']} log={args.log_file} state={args.state_file}"
    )
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
