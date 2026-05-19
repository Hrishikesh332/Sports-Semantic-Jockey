import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GAME_TAG = "sports"
SOURCE_VIDEOS = [
    ROOT / "data/games/gamess/F1 2021 Monaco Race Replay.mp4",
    ROOT / "data/games/gamess/Arsenal vs Manchester United Full Match Jan 22 2023.mp4",
    ROOT / "more videos/Kansas vs Baylor Feb 26 2022.mp4",
    ROOT / "more videos/2022 All-Star Game Metropolitan vs Pacific 3-on-3.mp4",
    ROOT / "more videos/Villanova vs Baylor Dec 12 2021.mp4",
]
INDEX_VIDEOS = [
    {
        "path": ROOT / "data/games/gamess/f1_parts/F1 2021 Monaco Race Replay part 00.mp4",
        "source_name": "F1 2021 Monaco Race Replay.mp4",
        "offset_seconds": 0,
    },
    {
        "path": ROOT / "data/games/gamess/f1_parts/F1 2021 Monaco Race Replay part 01.mp4",
        "source_name": "F1 2021 Monaco Race Replay.mp4",
        "offset_seconds": 2160.5584,
    },
    {
        "path": ROOT / "data/games/gamess/f1_parts/F1 2021 Monaco Race Replay part 02.mp4",
        "source_name": "F1 2021 Monaco Race Replay.mp4",
        "offset_seconds": 4321.117402,
    },
    {
        "path": ROOT / "data/games/gamess/Arsenal vs Manchester United Full Match Jan 22 2023.mp4",
        "source_name": "Arsenal vs Manchester United Full Match Jan 22 2023.mp4",
        "offset_seconds": 0,
    },
    {
        "path": ROOT / "more videos/Kansas vs Baylor Feb 26 2022.mp4",
        "source_name": "Kansas vs Baylor Feb 26 2022.mp4",
        "offset_seconds": 0,
    },
    {
        "path": ROOT / "more videos/2022 All-Star Game Metropolitan vs Pacific 3-on-3.mp4",
        "source_name": "2022 All-Star Game Metropolitan vs Pacific 3-on-3.mp4",
        "offset_seconds": 0,
    },
    {
        "path": ROOT / "more videos/Villanova vs Baylor Dec 12 2021.mp4",
        "source_name": "Villanova vs Baylor Dec 12 2021.mp4",
        "offset_seconds": 0,
    },
]

sys.path.insert(0, str(ROOT))

from app.services.ingestion import run_ingestion


def main():
    load_env(ROOT / ".env")
    if not os.environ.get("TWELVELABS_API_KEY"):
        raise SystemExit("TWELVELABS_API_KEY is required")

    payload = {
        "tag": GAME_TAG,
        "label": "Sports",
        "sport": "Sports",
        "source_videos": [{"path": str(path)} for path in SOURCE_VIDEOS],
        "index_videos": [
            {
                "path": str(spec["path"]),
                "source_name": spec["source_name"],
                "offset_seconds": spec["offset_seconds"],
            }
            for spec in INDEX_VIDEOS
        ],
        "state_file": "sports_ingest_state.json",
        "generate_highlights": True,
    }
    result = run_ingestion(payload, progress=print_status)
    print(json.dumps(result, indent=2, ensure_ascii=False))


def load_env(path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def print_status(message):
    print(f"[{timestamp()}] {message}", flush=True)


if __name__ == "__main__":
    main()
