# Sports Jockey Backend

Flask backend for uploading videos to TwelveLabs, creating knowledge stores,
indexing assets, running Marengo search, serving TwelveLabs HLS streams, using
Jockey for chat/pass-through workflows, and generating Workspace highlight reels
with Jockey over the configured knowledge base.

## Setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Production command:

```bash
gunicorn app:app --bind 0.0.0.0:${PORT:-5000} --timeout 800
```

Render's Python runtime injects a default `GUNICORN_CMD_ARGS` value that binds
gunicorn to `0.0.0.0:10000`. Keep the explicit `--bind` in the start command so
the service binds to Render's active `PORT` value instead of the injected
default.

Environment example:

```env
TWELVELABS_API_KEY=
INDEX_ID=
TWELVELABS_PEGASUS_MODEL=pegasus1.5
PORT=5000
CORS_ALLOWED_ORIGINS=https://sports-semantic-jockey.vercel.app,http://localhost:5173,http://127.0.0.1:5173
APP_URL=
KEEP_ALIVE_ENABLED=true
KEEP_ALIVE_INTERVAL_MINUTES=9
KEEP_ALIVE_PATH=/health
KEEP_ALIVE_URL=
KEEP_ALIVE_TIMEOUT_SECONDS=15
DEFAULT_GAME_REGISTRATIONS_JSON=
```

`APP_URL` should be the deployed backend URL, for example `https://your-app.example.com`.
On Render, the backend falls back to `RENDER_EXTERNAL_URL` when `APP_URL` is not
set. When an app URL is available and the backend is run through `app.py` or
`gunicorn app:app`,
APScheduler starts a background keep-alive job and pings the health endpoint
every 9 minutes. Set `KEEP_ALIVE_URL` only if you need to override the exact URL
being called.

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist for browser requests. The
default includes the deployed Vercel app and local Vite dev origins.

`TWELVELABS_API_KEY` and `INDEX_ID` are required for the live TwelveLabs flows.
`INDEX_ID` is the TwelveLabs index used by Marengo search and indexed playback
metadata. `TWELVELABS_PEGASUS_MODEL` defaults to `pegasus1.5` for legacy
analysis helpers, while Dashboard analysis uses the Jockey model configured by
`TWELVELABS_MODEL`.
Useful optional runtime knobs include `TWELVELABS_REQUEST_TIMEOUT_SECONDS`,
`TWELVELABS_ANALYZE_RETRY_ATTEMPTS`, `PEGASUS_SYNC_WINDOW_SECONDS`,
`SPORTS_STREAM_INFO_CACHE_TTL_SECONDS`,
`SPORTS_UPLOAD_ASSET_POLL_ATTEMPTS`, `SPORTS_UPLOAD_ASSET_POLL_INTERVAL_SECONDS`,
and `SPORTS_UPLOAD_BACKGROUND_WORKERS`.

Assembly reels are generated from TwelveLabs HLS streams and cached locally only
for reuse/download. The backend has a built-in 500 MB reel cache budget, removes
old cached `.mp4` reels before and after generation, rejects a single generated
reel if it is larger than the reel cache budget, and renders assembly segments
with one worker to reduce temporary disk pressure on small app disks.

`DEFAULT_GAME_REGISTRATIONS_JSON` can provide one game object or an array of game
objects when ignored local `data/games/*.json` files are not present in a
deployed environment. The frontend needs `tag`, `label`, `sport`,
`knowledge_store_id`, `source_videos`, and `video_asset_ids` for the live
backend flow. `INDEX_ID` is required for semantic search, index ingestion, and
Workspace playback/index metadata.
`marengo_video_ids` is optional metadata for mapping indexed results back to
source videos. `/games/<tag>/highlight-reels` resolves the selected source
video, builds scoped context, and calls Jockey `/responses` with the configured
`knowledge_store_id` and schema-shaped `text.format` output. Generated response
logs are not used.

Minimal shape:

```json
{
  "tag": "sports",
  "label": "Sports",
  "sport": "Sports",
  "knowledge_store_id": "ks_...",
  "source_videos": ["Match.mp4"],
  "video_asset_ids": {"Match.mp4": "asset_id"},
  "marengo_video_ids": {"Match.mp4": "indexed_video_id"}
}
```

The backend loads `backend/.env` first and `backend/.env.local` second, with
`.env.local` taking precedence. You can keep deployment-specific values such as
`APP_URL` in `.env.local`.

## Repository Hygiene

Do **not** commit secrets, local runtime state, or live TwelveLabs account
details to GitHub.

**Never commit**

| Path / pattern | Why |
|---|---|
| `backend/.env`, `backend/.env.local` | API keys and deployment secrets |
| `backend/data/games/*.json` | Live `knowledge_store_id`, `video_asset_ids`, `marengo_video_ids` |
| `backend/data/videos/`, `reels/`, `thumbnails/` | Local media |
| `backend/data/videosss_ingest_state.json` | Resumable upload state |
| `backend/data/videosss_upload*.log` | Upload logs |
| `backend/data/knowledge_base_video_ids.md` | Local inventory notes with live IDs |
| `.DS_Store` | Local macOS metadata |

**Do not paste into docs, commits, or PRs**

- Real `TWELVELABS_API_KEY` values
- Live `ks_...` knowledge-store IDs
- Live `ksi_...` knowledge-store item IDs
- Live `6a...` asset IDs or indexed-asset IDs
- Full inventories exported from your TwelveLabs account

Use placeholders in documentation and examples: `ks_...`, `ksi_...`, `6a...`,
`indexed_asset_id`, and generic filenames like `Match.mp4`.

**Safe to commit**

- Application code under `app/`
- Frontend demo code
- `.env.example` with empty values
- Docs that use placeholders only
- Scripts that read secrets from the environment at runtime

Before pushing, run:

```bash
git status
git diff
```

If you see `.env`, local `data/` artifacts, or live TwelveLabs IDs in tracked
files, remove or redact them before opening a PR.

## Structure

```text
app/
  api/routes/          Flask endpoints
  core/                config, errors, validation
  domain/highlights/   highlight schemas, prompts, parsing
  integrations/        TwelveLabs HTTP client
  services/            application use cases
data/games/            local analyzed game registry ignored by git
data/videos/           local videos ignored by git
scripts/               smoke tests
app.py                 local entrypoint
wsgi.py                backward-compatible entrypoint
```

## Workspace Metadata

Dashboard analysis is stored on each source video's TwelveLabs **indexed asset**
`user_metadata`, not in local JSON files.

| Metadata field | Purpose |
|---|---|
| `sports_jockey_highlight_reels_v1` | Cached Dashboard highlight reels (Jockey output) |
| `sports_jockey_highlight_reels_summary_v1` | Summary: clip counts, generated_at |
| `sports_jockey_entity_tracking_v1` | Cached entity tracking manifest |
| `sports_jockey_entity_tracking_summary_v1` | Summary: entity count, generated_at |
| `sports_jockey_workspace_v1` | Append-only saved clip analyses and Jockey chat turns |
| `sports_jockey_workspace_summary_v1` | Summary: counts by kind |

Read path:

1. Resolve `video_name` → registered `asset_id` → indexed asset under `INDEX_ID`.
2. Read cached metadata from `GET /indexes/{INDEX_ID}/indexed-assets/{id}`.
3. On cache miss, call Jockey or Pegasus, then patch metadata back to the same indexed asset.

API responses include provenance helpers such as `_pegasus_metadata` (highlights)
and `_jockey_metadata` (entity tracking, clip analysis) so the UI can show
whether data came from cache or live generation.

## API Reference

Base URL examples:

```text
http://127.0.0.1:5000          # local Flask / gunicorn
https://your-backend.example   # deployed backend
```

All JSON bodies use `Content-Type: application/json` unless noted otherwise.
Replace `<tag>` with a registered game tag such as `sports`. Replace
`<video_name>` with a registered source filename such as `Match.mp4`.

### Endpoint index

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/` | Health check alias |
| POST | `/assets` | Upload a TwelveLabs asset |
| POST | `/assets/<asset_id>/index` | Add asset to `INDEX_ID` |
| POST | `/knowledge-stores` | Create knowledge store |
| POST | `/knowledge-stores/<store_id>/items` | Add asset to knowledge store |
| GET | `/knowledge-stores/<store_id>/items/<item_id>` | Knowledge-store item status |
| POST | `/ingestions` | Full ingestion workflow |
| POST | `/responses` | Pass-through Jockey `/responses` |
| POST | `/highlight-reels` | Legacy direct highlight generation |
| GET | `/games` | List games |
| POST | `/games` | Register a game |
| GET | `/games/<tag>` | Get one game |
| GET | `/games/<tag>/index-videos` | Indexed videos + metadata flags |
| GET | `/games/<tag>/discover-videos` | Discover playback inventory |
| POST | `/games/<tag>/highlight-reels` | Dashboard highlights (+ optional entity tracking) |
| POST | `/games/<tag>/entity-tracking` | Entity tracking only |
| POST | `/games/<tag>/clip-analysis` | Selected-clip Pegasus analysis |
| POST | `/games/<tag>/search` | Marengo semantic search |
| POST | `/games/<tag>/jockey-chat` | Jockey chat / reel manifest |
| POST | `/games/<tag>/upload` | Upload video into workspace |
| POST | `/games/<tag>/videos/<video_name>/repair` | Re-queue broken video registration |
| GET | `/games/<tag>/videos/<video_name>/jockey-workspace` | Read saved workspace metadata |
| POST | `/games/<tag>/videos/<video_name>/jockey-workspace/saved-clip-analysis` | Append clip analysis save |
| POST | `/games/<tag>/videos/<video_name>/jockey-workspace/saved-jockey-turn` | Append Jockey turn to one video |
| POST | `/games/<tag>/jockey-workspace/saved-jockey-turn` | Append Jockey turn across videos |
| GET | `/games/<tag>/media/<video_name>` | Local file playback |
| GET | `/games/<tag>/stream/<video_name>` | TwelveLabs HLS stream info |
| GET | `/games/<tag>/thumbnail/<video_name>` | Video thumbnail |
| GET | `/games/<tag>/reel/<video_name>` | Export clip MP4 |
| GET | `/games/<tag>/reel-thumbnail/<video_name>` | Reel thumbnail JPEG |

---

### Health

#### `GET /health` · `GET /`

Returns:

```json
{"status": "ok"}
```

---

### TwelveLabs pass-through routes

These wrap TwelveLabs APIs directly. Prefer the `/games/<tag>/...` routes for
app-facing workflows.

#### `POST /assets`

Upload a local file to TwelveLabs.

Content type: `multipart/form-data`

| Field | Required | Notes |
|---|---|---|
| `method` | yes | Must be `direct` |
| `file` | yes | Video file |

Returns: TwelveLabs asset object.

#### `POST /assets/<asset_id>/index`

Adds an existing asset to the configured search index (`INDEX_ID`).

Optional body:

```json
{"enable_video_stream": true}
```

Returns `202` with the indexed-asset response.

#### `POST /knowledge-stores`

Creates a knowledge store.

Required body field: `name`

#### `POST /knowledge-stores/<store_id>/items`

Adds one ready asset to a knowledge store.

```json
{"asset_id": "6a..."}
```

#### `GET /knowledge-stores/<store_id>/items/<item_id>`

Returns knowledge-store item indexing status.

#### `POST /ingestions`

Runs the full ingestion workflow: local playback files, knowledge-store items,
index registration, and game registration.

#### `POST /responses`

Pass-through to TwelveLabs Jockey `/responses`.

#### `POST /highlight-reels`

Legacy direct highlight generation from a knowledge store id.

Required: `knowledge_store_id`

Prefer `POST /games/<tag>/highlight-reels` for the Dashboard.

---

### Games — registration and catalog

#### `GET /games`

Lists public game registrations.

#### `POST /games`

Registers a game pointing at a TwelveLabs knowledge store.

Required: `tag`, `label`, `sport`, `knowledge_store_id`

```json
{
  "tag": "sports",
  "label": "Sports",
  "sport": "Sports",
  "knowledge_store_id": "ks_...",
  "source_videos": ["Match.mp4"],
  "video_asset_ids": {"Match.mp4": "6a..."},
  "marengo_video_ids": {"Match.mp4": "indexed_asset_id"},
  "video_reference_map": {},
  "wsc_baseline": {}
}
```

#### `GET /games/<tag>`

Returns one public game registration.

#### `GET /games/<tag>/index-videos`

Returns videos currently present in the configured TwelveLabs index, including
cache flags used by the Dashboard:

```json
{
  "index_videos": [
    {
      "display_name": "Match.mp4",
      "source_video_name": "Match.mp4",
      "asset_id": "6a...",
      "indexed_asset_id": "indexed_asset_id",
      "has_jockey_highlight_metadata": true,
      "has_jockey_entity_tracking_metadata": true,
      "has_jockey_workspace_metadata": false,
      "jockey_highlight_clip_counts": {},
      "jockey_entity_tracking_entity_count": 6,
      "jockey_workspace_counts": {"clip_analysis": 0, "jockey_turn": 0, "total": 0}
    }
  ]
}
```

#### `GET /games/<tag>/discover-videos`

Returns Discover inventory with playback readiness, stream paths, and thumbnails.

#### `POST /games/<tag>/videos/<video_name>/repair`

Re-queues repair for a registered source video whose TwelveLabs bindings are
stale. Returns `202`.

---

### Games — Dashboard analysis

These endpoints scope work to one registered `video_name`. Jockey calls use the
game's `knowledge_store_id`; metadata is written to that video's indexed asset.

#### `POST /games/<tag>/highlight-reels`

Primary Dashboard endpoint. Reads cached highlight reels from indexed-asset
metadata when present; otherwise generates with Jockey and stores the result.

Optional body:

```json
{
  "video_name": "Match.mp4",
  "asset_id": "6a...",
  "indexed_asset_id": "indexed_asset_id",
  "include_entity_tracking": true,
  "force_generate": false,
  "match_context": "Optional extra context",
  "wsc_baseline": {}
}
```

| Field | Notes |
|---|---|
| `video_name` | Registered source video. Required for per-video Dashboard scope. |
| `asset_id` | Optional hint from `index-videos`. |
| `indexed_asset_id` | Optional hint from `index-videos`. |
| `include_entity_tracking` | When `true`, also load or generate entity tracking in the same request. |
| `force_generate` | When `true`, bypass cached metadata and regenerate. |

Response without entity tracking: highlight reel schema plus `_pegasus_metadata`.

Response with `include_entity_tracking: true`:

```json
{
  "video_name": "Match.mp4",
  "highlight_reels": { "...": "..." },
  "entity_tracking": { "...": "..." }
}
```

#### `POST /games/<tag>/entity-tracking`

Entity tracking only. Metadata-first with optional `force_generate`.

```json
{
  "video_name": "Match.mp4",
  "force_generate": false
}
```

Returns entity manifest with `_jockey_metadata` provenance.

#### `POST /games/<tag>/clip-analysis`

Selected-clip analysis for Discover. Uses Pegasus on a clip window only — not
whole-video Jockey analysis. Generation is read-only; it does not write to
workspace metadata until the user clicks Save.

```json
{
  "video_name": "Match.mp4",
  "video_reference": "optional Marengo reference",
  "start_time": "1:23",
  "end_time": "1:35",
  "asset_id": "6a...",
  "query": "goal celebration",
  "description": "Marengo match text",
  "relevance": "Marengo rationale",
  "force_generate": false
}
```

Returns analysis object with `_jockey_metadata` provenance.

---

### Games — workspace metadata saves

Saved items append to `sports_jockey_workspace_v1` on the source video's indexed
asset.

#### `GET /games/<tag>/videos/<video_name>/jockey-workspace`

Returns workspace payload and summary counts for one video.

#### `POST /games/<tag>/videos/<video_name>/jockey-workspace/saved-clip-analysis`

Manually append a clip analysis item.

```json
{
  "analysis": { "...": "SelectedClipAnalysis object..." },
  "search_context": {
    "title": "Search title",
    "query": "search query",
    "start_time": "1:23",
    "end_time": "1:35"
  }
}
```

Returns `201` with `{ item, duplicate, summary, storage }`.

#### `POST /games/<tag>/videos/<video_name>/jockey-workspace/saved-jockey-turn`

Append one Jockey chat turn scoped to a single source video.

```json
{
  "prompt": "Show me the biggest run.",
  "skill_key": "highlight_hunt",
  "show_reel": true,
  "response": {
    "session_id": "...",
    "narrative_summary": "...",
    "clips": []
  }
}
```

#### `POST /games/<tag>/jockey-workspace/saved-jockey-turn`

Same payload as above, but resolves clips to registered source videos and saves
the turn to each matching video's workspace metadata.

---

### Games — Discover, chat, upload

#### `POST /games/<tag>/search`

Marengo semantic search against `INDEX_ID`.

```json
{
  "query": "goal celebration",
  "limit": 12,
  "filter": "semantic",
  "search_options": ["visual", "audio"],
  "video_name": "Optional registered source video"
}
```

#### `POST /games/<tag>/jockey-chat`

Jockey chat with optional reel manifest output.

```json
{
  "message": "What stands out in this game?",
  "include_reel": false,
  "limit": 4,
  "video_name": "Optional registered source video",
  "session_id": "Optional prior session id",
  "conversation_history": []
}
```

When `video_name` is omitted, Jockey may reason across the whole knowledge store.

#### `POST /games/<tag>/upload`

Upload one video into an existing game workspace.

Content type: `multipart/form-data`

| Field | Required |
|---|---|
| `method` | yes, must be `direct` |
| `file` | yes |

Returns `202` with `{ status: "indexing", video_name, asset_id, game }`.

Example:

```bash
curl -X POST "http://127.0.0.1:5000/games/sports/upload" \
  -F "method=direct" \
  -F "file=@/absolute/path/to/video.mp4"
```

---

### Games — media and playback

#### `GET /games/<tag>/media/<video_name>`

Serves local file from `data/videos/`.

#### `GET /games/<tag>/stream/<video_name>`

Returns TwelveLabs HLS stream descriptor:

```json
{
  "provider": "twelvelabs",
  "type": "hls",
  "asset_id": "6a...",
  "asset_status": "ready",
  "hls_status": "ready",
  "manifest_url": "https://.../playlist.m3u8"
}
```

#### `GET /games/<tag>/thumbnail/<video_name>`

Local or indexed thumbnail, otherwise SVG placeholder.

#### `GET /games/<tag>/reel/<video_name>`

Export clip MP4 from HLS.

Query params: `start`, `end`, `format`, `name`, `download`

#### `GET /games/<tag>/reel-thumbnail/<video_name>`

Reel thumbnail JPEG or SVG placeholder.

---

### Batch metadata warm

Warm Dashboard highlight + entity metadata for every registered indexed video:

```bash
cd backend
python app.py   # in another terminal

python3 scripts/warm_dashboard_metadata.py --tag sports
python3 scripts/warm_dashboard_metadata.py --tag sports --force
python3 scripts/warm_dashboard_metadata.py --tag sports --video "Match.mp4"
```

Uses:

- `GET /games/<tag>/index-videos`
- `POST /games/<tag>/highlight-reels` with `include_entity_tracking: true`

Logs:

```text
logs/dashboard_metadata_warm.log
data/dashboard_metadata_warm_state.json
```

---

## Knowledge Base

The app uses "knowledge base" as the product-facing name for a TwelveLabs
knowledge store. The default Sports registration lives in local
`backend/data/games/sports.json` (gitignored). That file should point at your
live store using placeholders like:

```text
knowledge_store_id: ks_...
name: Sports Knowledge Base
metadata: {"game_tag": "sports", "source": "sports-jockey"}
```

Do not commit the real `sports.json` value or copy live IDs into this README.

### Knowledge Base Components

The Sports knowledge store was created with a JSON-schema enrichment config.
These are the domain components TwelveLabs extracts for each indexed video item:

| Component | Purpose |
|---|---|
| `score_changes` | Every scoring event in chronological order. |
| `key_plays` | Important non-scoring plays that change momentum or explain scoring context. |
| `emotional_moments` | Celebrations, disappointment, bench reactions, player emotion, and tension. |
| `fan_reactions` | Crowd, fan, stadium, mascot, broadcast, and atmosphere moments. |
| `broadcast_context` | Scoreboard shots, replays, graphics, announcer cues, and contextual footage. |

### IDs And Local Mapping

There are three related but separate identifiers in this app:

| Field | Example | Meaning |
|---|---|---|
| `knowledge_store_id` | `ks_...` | The TwelveLabs knowledge store, shared by Jockey and knowledge-base item ingestion. |
| Knowledge-store item ID | `ksi_...` | A single asset indexed into the knowledge store. Item status is usually `ready`, `processing`, or `failed`. |
| `asset_id` | `6a...` | The uploaded TwelveLabs video asset. The same asset can be used by the knowledge store and the Marengo index. |
| `marengo_index_id` / `INDEX_ID` | `6a...` | The separate TwelveLabs index used for semantic search, HLS-backed indexed assets, and Pegasus metadata storage. |
| `marengo_video_ids` | `video_name -> indexed_asset_id` | Local mapping from an app source video to its indexed asset under `INDEX_ID`. |

The local game registry stores the app-facing mapping:

| Registry field | Role |
|---|---|
| `source_videos` | Source names shown in the app. These names drive playback and Workspace selection. |
| `video_asset_ids` | Maps source video names to TwelveLabs playback/source asset IDs. |
| `video_reference_map` | Maps Jockey references, `ksi_...` item IDs, raw item IDs, filenames, and asset IDs back to source video names. |
| `marengo_video_ids` | Maps source video names to indexed assets in the Marengo/Pegasus index. |

Knowledge-store items power Jockey and knowledge-base reasoning. Marengo indexed
assets power Discover search, thumbnails, HLS stream lookup, and Workspace
Pegasus metadata reuse. A video usually needs to be present in both places for
the full app experience.

### Ingestion Paths

`POST /ingestions` is the backend-owned full ingestion flow. It creates or
reuses the knowledge store, uploads source/index assets, calls
`POST /knowledge-stores/<store_id>/items`, polls item status, and writes the
local `data/games/<tag>.json` registration.

`POST /games/<tag>/upload` is the app upload path. It saves the local file,
uploads it as a TwelveLabs asset, then a background worker adds the same
`asset_id` to both:

```text
POST /knowledge-stores/<knowledge_store_id>/items
POST /indexes/<INDEX_ID>/indexed-assets
```

After those calls finish, the backend updates `source_videos`,
`video_asset_ids`, `marengo_video_ids`, and `video_reference_map`.

### Live Debug Commands

Use these commands from the `backend/` parent directory. They load the API key
through `python-dotenv` instead of shell-sourcing `.env`, which is safer when the
file contains values that are not shell-compatible.

```bash
API_KEY="$(python3 -m dotenv -f backend/.env get TWELVELABS_API_KEY)"
STORE_ID="$(jq -r '.knowledge_store_id' backend/data/games/<tag>.json)"

curl -s -H "x-api-key: ${API_KEY}" \
  "https://api.twelvelabs.io/v1.3/knowledge-stores/${STORE_ID}" | jq

curl -s -H "x-api-key: ${API_KEY}" \
  "https://api.twelvelabs.io/v1.3/knowledge-stores/${STORE_ID}/items?page=1" | jq

curl -s -H "x-api-key: ${API_KEY}" \
  "https://api.twelvelabs.io/v1.3/knowledge-stores/${STORE_ID}/items?page=2" | jq
```

The backend wraps create-item and get-item-status routes, but it does not
currently expose a list-items route. For a live inventory, call the TwelveLabs
`/knowledge-stores/<store_id>/items` endpoint directly as shown above.

### Live Inventory (local only)

Query your live knowledge-store inventory locally. Do not commit exported item
lists, asset IDs, or indexed-asset IDs to the repository.

Example shape only:

| Status | Knowledge-store item | Asset ID | Local source mapping |
|---|---|---|---|
| ready | `ksi_...` | `6a...` | `Match.mp4` |
| ready | `ksi_...` | `6a...` | `Another Game.mp4` |

Use the debug commands below with your local `backend/data/games/<tag>.json`
registration and `.env` API key. If a source video is missing from the live
store, add or repair it through `/games/<tag>/upload`,
`/games/<tag>/videos/<video_name>/repair`, or the lower-level knowledge-store
item route.

## Smoke Test

```bash
python3 scripts/olympics_smoke_test.py
```

The smoke test reads local videos from `data/videos/`, exercises upload,
knowledge-store, game registration, media, and highlight routes, and prints a
summary. For Dashboard metadata reuse, use a source video whose `asset_id` is
already indexed under `INDEX_ID`; otherwise index the asset first with
`POST /assets/<asset_id>/index`.
