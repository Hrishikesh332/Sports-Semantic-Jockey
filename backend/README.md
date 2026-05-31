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
flask --app app run --port 5000
```

Production command:

```bash
gunicorn wsgi:app --bind 0.0.0.0:${PORT:-5000} --timeout 800
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
set. When an app URL is available and the backend is run through `wsgi.py`,
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
wsgi.py                local entrypoint
```

## Workspace Flow

Workspace highlight display is metadata-led and API-backed:

1. Resolve the selected source video to its registered TwelveLabs `asset_id`.
2. Fetch `GET /assets/{asset_id}` and ensure the asset is ready.
3. Find the indexed asset for the same selected asset through
   `GET /assets/{asset_id}/indexed-assets`.
4. Read reusable Pegasus output on the matching indexed asset `user_metadata`
   through `GET /indexes/{INDEX_ID}/indexed-assets/{id}`.
5. If the metadata is absent, stale, or mismatched, analyze the source asset with
   Pegasus, store both the compact reels and full detailed response back to
   indexed asset `user_metadata`, then return the saved response shape.

The metadata fields are:

```text
sports_jockey_pegasus_reels_v2
sports_jockey_pegasus_detailed_response_v2
sports_jockey_pegasus_reels_hash_v2
sports_jockey_pegasus_model_v2
sports_jockey_pegasus_asset_id_v2
sports_jockey_pegasus_indexed_asset_id_v2
sports_jockey_pegasus_index_id_v2
sports_jockey_pegasus_source_video_v2
sports_jockey_pegasus_generated_at_v2
```

Selected-video responses include a compact `_pegasus_metadata` provenance object
so the UI can show that the displayed reels came from indexed asset
`user_metadata`.

The backend does not read from or write to generated response logs, pinned logs,
or local temporary JSON state for Workspace results.

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

## Endpoints

### `GET /health`

Lightweight health check used by the keep-alive scheduler.

Returns:

```json
{"status": "ok"}
```

### `POST /assets`

Uploads a local file to TwelveLabs. Small files use direct upload; large files use TwelveLabs multipart upload.

Content type: `multipart/form-data`

Fields:

| Field | Type | Required |
|---|---|---|
| `method` | string | yes, must be `direct` |
| `file` | file | yes |

Returns: TwelveLabs asset object.

### `POST /assets/<asset_id>/index`

Adds an existing TwelveLabs asset to the configured search/analyze index from
`INDEX_ID`.

Optional body:

```json
{
  "enable_video_stream": true
}
```

Returns `202` with the TwelveLabs indexed-asset response. The API response does
not expose the configured index id.

### `POST /knowledge-stores`

Creates a TwelveLabs knowledge store.

Body:

```json
{
  "name": "Store name",
  "ingestion_config": {},
  "metadata": {}
}
```

Required: `name`

Returns: TwelveLabs knowledge store object.

### `POST /knowledge-stores/<store_id>/items`

Adds one ready asset to a knowledge store for indexing.

Body:

```json
{
  "asset_id": "asset_id"
}
```

Returns: TwelveLabs knowledge store item object.

### `POST /ingestions`

Runs the backend-owned ingestion workflow end to end: link local source videos
for playback, create or reuse a TwelveLabs knowledge store, upload source assets
for HLS playback, upload/index the configured knowledge-store videos, poll until
items are ready, and register the local game. It does not persist local state
JSON or generate debug highlight response logs.

Body:

```json
{
  "tag": "sports",
  "label": "Sports",
  "sport": "Sports",
  "source_videos": [
    {"path": "data/videos/match.mp4"}
  ],
  "index_videos": [
    {"path": "data/videos/match.mp4", "source_name": "match.mp4", "offset_seconds": 0}
  ]
}
```

`index_videos` is optional. Provide it when a source video must be indexed as multiple parts; `source_name` maps each indexed part back to the playable source video, and `offset_seconds` shifts returned clip timestamps back onto the full source timeline.

Returns the app-facing registered game, source `video_asset_ids`, and item statuses.

### `GET /knowledge-stores/<store_id>/items/<item_id>`

Gets the indexing status for a knowledge store item.

Returns: TwelveLabs knowledge store item object.

### `POST /responses`

Pass-through endpoint for TwelveLabs Jockey responses.

Body:

```json
{
  "model": "jockey1.0",
  "input": [
    {"type": "message", "role": "user", "content": "Question"}
  ],
  "knowledge_store_id": "store_id"
}
```

Returns: TwelveLabs response object.

### `POST /highlight-reels`

Generates structured highlight variants from a ready knowledge store.

Body:

```json
{
  "knowledge_store_id": "store_id",
  "match_context": "Optional match context",
  "wsc_baseline": {}
}
```

Required: `knowledge_store_id`

Returns:

```json
{
  "match_summary": "...",
  "standard_stats": {"title": "Standard Stats / WSC style", "clips": []},
  "best_plays": {"title": "Best Plays", "clips": []},
  "emotional_moments": {"title": "Emotional Moments", "clips": []},
  "fan_experience": {"title": "Fan Experience", "clips": []},
  "behind_the_scenes": {"title": "Behind the Scenes", "clips": []}
}
```

Each clip includes `start_time`, `end_time`, `video_reference`, `clip_type`,
`category`, `source_type`, `description`, `score_context`, `selection_reason`,
`confidence`, `explainability_label`, `evidence_summary`, `visual_evidence`,
`audio_evidence`, `transcript_evidence`, `timeline_rationale`, and
`editorial_use`.

### `POST /games`

Registers a local analyzed game tag that points to a real TwelveLabs knowledge store.

Body:

```json
{
  "tag": "match-tag",
  "label": "Match Label",
  "sport": "Soccer",
  "knowledge_store_id": "store_id",
  "source_videos": ["match.mp4"],
  "video_asset_ids": {"match.mp4": "asset_id"},
  "marengo_video_ids": {"match.mp4": "indexed_video_id"},
  "video_reference_map": {"jockey_video_reference": "match.mp4"},
  "wsc_baseline": {}
}
```

Required: `tag`, `label`, `sport`, `knowledge_store_id`

Returns: app-facing registered game object. Highlight log fields are ignored so
runtime generation stays API-backed.

### `GET /games`

Lists app-facing game registrations without internal fields. The checked-in demo
registration is returned even when ignored local `data/games/*.json` files are
not present in a deployed environment.

### `GET /games/<tag>`

Returns one app-facing game registration without internal fields.

### `POST /games/<tag>/highlight-reels`

Returns the Dashboard highlight package from TwelveLabs Jockey over the
configured knowledge base. Source-video metadata, search, thumbnails, streaming,
and reel playback stay live through backend/TwelveLabs endpoints. Generated
response logs and legacy pinned logs are not used.

For a selected source video, the backend resolves the registered video reference,
builds source-scoped match context, and calls `/responses` with
`knowledge_store_id` plus `text.format` JSON schema output. The response includes
the same highlight schema as the legacy endpoint: a sparse stats baseline plus
semantic lanes for best plays, emotional moments, fan experience, and
behind-the-scenes moments.

Body:

```json
{
  "video_name": "Optional registered source video name",
  "match_context": "Optional match context",
  "wsc_baseline": {}
}
```

Returns the same highlight schema as `POST /highlight-reels`.

`video_name` is optional, but the frontend Workspace sends it so Jockey can keep
the answer scoped to the active source video.

### `POST /games/<tag>/upload`

Uploads one video into an existing game workspace. This is the preferred app
endpoint for adding a video because it handles all three backend-side steps:
saving local playback media, uploading the asset to TwelveLabs, and scheduling
knowledge-base plus index registration.

Prerequisites:

1. `TWELVELABS_API_KEY` must be set.
2. `INDEX_ID` or the game's `marengo_index_id` must be set.
3. The game tag must already exist and include a `knowledge_store_id`. Create it
   with `POST /games` or provide it through `DEFAULT_GAME_REGISTRATIONS_JSON`.

Request:

```bash
curl -X POST "http://127.0.0.1:5000/games/sports/upload" \
  -F "method=direct" \
  -F "file=@/absolute/path/to/video.mp4"
```

Form fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `method` | string | yes | Must be `direct`. This tells the backend to accept a direct multipart file upload. |
| `file` | file | yes | MP4 or another TwelveLabs-supported video file. |

Immediate response:

```json
{
  "status": "indexing",
  "video_name": "video.mp4",
  "asset_id": "6a...",
  "knowledge_store_id": "ks_...",
  "index_configured": true,
  "created_search_index": false,
  "message": "Upload accepted. The index and knowledge-base item will be ready in a few minutes.",
  "game": {}
}
```

`status: "indexing"` means the upload was accepted. The backend has already
saved the video in `backend/data/videos/` and uploaded it as a TwelveLabs asset.
A background worker then waits for the asset to become ready and sends the same
`asset_id` to:

- `POST /knowledge-stores/<knowledge_store_id>/items`
- `POST /indexes/<INDEX_ID>/indexed-assets`

After those background steps complete, the backend updates
`backend/data/games/<tag>.json` with:

- `source_videos`
- `video_asset_ids`
- `marengo_video_ids`
- `video_reference_map`

Verification:

```bash
curl "http://127.0.0.1:5000/games/sports"
curl "http://127.0.0.1:5000/games/sports/index-videos"
```

Use `/games/<tag>/index-videos` when the UI needs the actual videos currently
present in the configured TwelveLabs index. This avoids relying on local-only
video mappings.

Large files:

The endpoint uploads the submitted file as-is. TwelveLabs can accept multipart
asset uploads, but video processing/indexing can reject media above the current
TwelveLabs processing limit, roughly 2.1 GB. For very large files, prepare a
smaller proxy MP4 first, or use the folder helper:

```bash
python3 backend/scripts/upload_videosss.py
```

That helper reads `backend/videosss/*.mp4`, creates upload-safe proxy files under
`backend/data/videosss_prepared/` when needed, uploads each video, adds it to the
existing Sports knowledge store, adds it to `INDEX_ID`, and saves resumable
state in `backend/data/videosss_ingest_state.json`.

Common failures:

| Status | Meaning | Fix |
|---|---|---|
| `400 method must be direct` | Missing or wrong form field. | Send `-F "method=direct"`. |
| `400 file is required` | No uploaded file. | Send `-F "file=@/absolute/path/video.mp4"`. |
| `404 game not found` | The tag does not exist. | Register the game first with `POST /games`. |
| `500 INDEX_ID is required` | No index is configured. | Set `INDEX_ID` or the game's `marengo_index_id`. |
| `media_filesize_too_large` | TwelveLabs rejected processing after upload. | Compress/proxy the file below the processing limit and retry. |

Advanced lower-level flow:

Use this only when you want to manually control each TwelveLabs step instead of
letting `/games/<tag>/upload` do it.

1. Upload an asset:

```text
POST /assets
```

2. Add it to the configured index:

```text
POST /assets/<asset_id>/index
```

3. Add it to a knowledge store:

```text
POST /knowledge-stores/<store_id>/items
```

### `POST /games/<tag>/jockey-chat`

Uses TwelveLabs Jockey only for the conversational chat section. The backend
calls `/responses` with `text.format` JSON schema output, so reel requests return
a typed timestamp manifest instead of free-form text. Normal chat requests return
a concise `narrative_summary` and no clips. Clip manifests are requested only
when the user asks for a reel or sends `include_reel: true`.

Body:

```json
{
  "message": "What stands out in this game?",
  "include_reel": false,
  "limit": 8,
  "video_name": "Optional registered source video name",
  "session_id": "Optional TwelveLabs response session id",
  "conversation_history": [
    {
      "prompt": "Find peak crowd reactions.",
      "narrative_summary": "Returned crowd-reaction candidates.",
      "clips": [
        {
          "video_reference": "match.mp4",
          "start_time": "18:45",
          "end_time": "19:05",
          "moment_type": "crowd_reaction",
          "confidence": 0.94
        }
      ]
    }
  ]
}
```

Pass the returned `session_id` back on later turns to refine the same Jockey
conversation, for example: "now filter to only moments where the crowd reaction
lasted more than 5 seconds." The frontend does this automatically for the
current game chat and also sends a compact rolling `conversation_history` for
the latest 5 completed turns.

Returns:

```json
{
  "session_id": "...",
  "message": "...",
  "narrative_summary": "...",
  "clips": [
    {
      "video_reference": "match.mp4",
      "start_time": "18:45",
      "end_time": "19:05",
      "moment_type": "crowd_reaction",
      "confidence": 0.94,
      "highlight_potential": 0.91
    }
  ]
}
```

### `POST /games/<tag>/search`

Runs live TwelveLabs semantic video search against the configured `INDEX_ID`. The backend calls `/v1.3/search` with visual/audio options, maps returned video references back to registered source videos, and normalizes the response for the Discover UI. This endpoint requires `INDEX_ID` and does not fall back to Jockey search.

Body:

```json
{
  "query": "goal celebration",
  "limit": 12,
  "filter": "semantic",
  "search_options": ["visual", "audio"],
  "video_name": "Optional registered source video name"
}
```

`filter` is optional and may be `all`, `semantic`, `standard_stats`, `best_plays`, `emotional_moments`, `fan_experience`, or `behind_the_scenes`. Search responses are not read from or written to generated reel logs.

### `POST /games/<tag>/clip-analysis`

Runs the Tier 1 per-clip workflow after Discover search: Marengo retrieves a
candidate clip, then Pegasus 1.5 analyzes that selected source-video window.
On first generate, the backend stores the result on the matching TwelveLabs
indexed asset `user_metadata` under `sports_jockey_workspace_v1`. Later requests
for the same clip window read from that metadata first.

Body:

```json
{
  "video_name": "Match.mp4",
  "video_reference": "optional Marengo video reference",
  "start_time": "18:45",
  "end_time": "19:05",
  "asset_id": "optional TwelveLabs source asset id from Marengo",
  "query": "goal celebration teammates",
  "description": "Marengo match description",
  "relevance": "Marengo match rationale"
}
```

Returns Pegasus-generated selected-clip analysis with `description`,
`emotional_tone`, `key_action`, `participants`, `moment_types`, `tags`,
`score_context`, visual/audio/transcript evidence, `producer_summary`,
`story_arc`, `editorial_use`, `recommended_formats`, `clip_boundary_notes`,
`rights_safety_notes`, and `confidence`. The frontend shows the selected clip on
the left and the Pegasus response on the right under Dashboard
`Selected Clip Analysis`.

### `GET /games/<tag>/videos/<video_name>/jockey-workspace`

Returns saved workspace metadata for one source video from indexed asset
`user_metadata`.

### `POST /games/<tag>/videos/<video_name>/jockey-workspace/saved-clip-analysis`

Appends a selected clip analysis item to that source video's workspace metadata.

### `POST /games/<tag>/videos/<video_name>/jockey-workspace/saved-jockey-turn`

Appends one Jockey chat turn to that source video's workspace metadata.

### `POST /games/<tag>/jockey-workspace/saved-jockey-turn`

Resolves clips in a Jockey response back to registered source videos and saves
the turn to each matching video's workspace metadata.

### `POST /games/<tag>/entity-tracking`

Runs a Jockey structured-output pass over the active knowledge-base source video
to extract entity tracking for the Dashboard.

Body:

```json
{
  "video_name": "Match.mp4"
}
```

Returns an entity manifest with a source summary, grounded entities, confidence
scores, timestamped appearances, and supported interactions. Entity names should
be specific only when grounded in the footage; otherwise the prompt asks Jockey
to use generic but useful labels such as `home crowd`, `Arsenal players`, or
`coaching staff`.

### `GET /games/<tag>/media/<video_name>`

Serves a registered local video file from `data/videos/` for demo playback.

### `GET /games/<tag>/stream/<video_name>`

Returns a TwelveLabs HLS stream descriptor for a registered source video.

```json
{
  "provider": "twelvelabs",
  "type": "hls",
  "asset_id": "asset_id",
  "asset_status": "ready",
  "hls_status": "ready",
  "manifest_url": "https://.../playlist.m3u8"
}
```

The frontend video player uses this endpoint and plays the returned TwelveLabs HLS manifest. The local `/media` route remains available for diagnostics.

### `GET /games/<tag>/thumbnail/<video_name>`

Returns a generated local thumbnail when available, otherwise an SVG placeholder.

### `GET /games/<tag>/reel/<video_name>`

Exports an MP4 clip from the registered video's live TwelveLabs HLS stream. This
is used for manual diagnostics and simple clip export, not for Workspace analysis.

Query parameters:

```text
start=<seconds>
end=<seconds>
format=9x16|16x9|1x1|4x5
name=<optional label>
download=0|1
```

### `GET /games/<tag>/reel-thumbnail/<video_name>`

Returns a generated local JPEG thumbnail for a reel time and format, or an SVG
placeholder when the thumbnail cannot be generated.

## Smoke Test

```bash
python3 scripts/olympics_smoke_test.py
```

The smoke test reads local videos from `data/videos/`, exercises upload,
knowledge-store, game registration, media, and highlight routes, and prints a
summary. For Workspace Pegasus metadata reuse, use a source video whose
`asset_id` is already indexed under `INDEX_ID`; otherwise index the asset first
with `POST /assets/<asset_id>/index`.
