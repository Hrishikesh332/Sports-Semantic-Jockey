# Sports Jockey Backend

Flask backend for uploading videos to TwelveLabs, creating knowledge stores, indexing assets, querying Jockey, and generating structured sports highlight reels.

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

Required environment:

```env
TWELVELABS_API_KEY=
PORT=5000
CORS_ALLOWED_ORIGINS=https://sports-semantic-jockey.vercel.app,http://localhost:5173,http://127.0.0.1:5173
APP_URL=
KEEP_ALIVE_ENABLED=true
KEEP_ALIVE_INTERVAL_MINUTES=9
KEEP_ALIVE_PATH=/health
KEEP_ALIVE_URL=
KEEP_ALIVE_TIMEOUT_SECONDS=15
```

`APP_URL` should be the deployed backend URL, for example `https://your-app.example.com`.
On Render, the backend falls back to `RENDER_EXTERNAL_URL` when `APP_URL` is not
set. When an app URL is available and the backend is run through `wsgi.py`,
APScheduler starts a background keep-alive job and pings the health endpoint
every 9 minutes. Set `KEEP_ALIVE_URL` only if you need to override the exact URL
being called.

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist for browser requests. The
default includes the deployed Vercel app and local Vite dev origins.

The backend loads `backend/.env` first and `backend/.env.local` second, with
`.env.local` taking precedence. You can keep deployment-specific values such as
`APP_URL` in `.env.local`.

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
logs/                  stored API responses
wsgi.py                local entrypoint
```

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

Runs the backend-owned ingestion workflow end to end: link local source videos for playback, create or reuse a TwelveLabs knowledge store, upload source assets for HLS playback, upload/index the configured knowledge-store videos, poll until items are ready, register the local game, and optionally generate per-video debug highlight response logs.

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
  ],
  "state_file": "sports_ingest_state.json",
  "generate_highlights": true
}
```

`index_videos` is optional. Provide it when a source video must be indexed as multiple parts; `source_name` maps each indexed part back to the playable source video, and `offset_seconds` shifts returned clip timestamps back onto the full source timeline.

Returns the app-facing registered game, source `video_asset_ids`, item statuses, and explicit debug highlight response logs when generated.

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

Each clip includes `start_time`, `end_time`, `video_reference`, `clip_type`, `category`, `source_type`, `description`, `score_context`, `selection_reason`, `confidence`, and `explainability_label`.

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
  "video_reference_map": {"jockey_video_reference": "match.mp4"},
  "highlight_response_log": "optional_debug_response_log.json",
  "wsc_baseline": {}
}
```

Required: `tag`, `label`, `sport`, `knowledge_store_id`

Returns: app-facing registered game object. Debug log fields are retained in the local registry for manual diagnostics, but they are not exposed through `/games` responses.

### `GET /games`

Lists local analyzed game registrations without debug log fields.

### `GET /games/<tag>`

Returns one local analyzed game registration without debug log fields.

### `POST /games/<tag>/highlight-reels`

Returns a complete per-source Jockey highlight response. Knowledge-base discovery, source-video metadata, thumbnails, and streaming stay live through backend/TwelveLabs endpoints. Only the generated Jockey reel response is cached: the backend first checks a generated response log for the requested source video, and only calls Jockey live with the tag's registered `knowledge_store_id` when no complete generated log exists. Legacy pinned response logs are still only available for manual debug replay with `use_pinned_log: true`; the frontend does not send that flag.

Body:

```json
{
  "video_name": "Optional registered source video name",
  "match_context": "Optional match context",
  "wsc_baseline": {},
  "use_pinned_log": false,
  "force_refresh": false,
  "ignore_log_cache": false
}
```

When the response is generated live for a `video_name`, the backend writes a generated response log with all required sections: `match_summary`, `standard_stats`, `best_plays`, `emotional_moments`, `fan_experience`, and `behind_the_scenes`. Use `force_refresh: true` or `ignore_log_cache: true` only when you intentionally want to bypass the generated log and regenerate.

Returns the same highlight schema as `POST /highlight-reels`.

### `POST /games/<tag>/search`

Runs live TwelveLabs Jockey natural-language video search for the registered game's `knowledge_store_id`. This follows the Jockey search recipe: the backend calls `/v1.3/responses` with `model: "jockey1.0"` and a structured JSON schema for search results, then maps returned video references back to registered source videos.

Body:

```json
{
  "query": "goal celebration",
  "limit": 12,
  "filter": "semantic",
  "video_name": "Optional registered source video name"
}
```

`filter` is optional and may be `all`, `semantic`, `standard_stats`, `best_plays`, `emotional_moments`, `fan_experience`, or `behind_the_scenes`. Search responses are not read from or written to generated reel logs.

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

## Smoke Test

```bash
python3 scripts/olympics_smoke_test.py
```

The smoke test reads local videos from `data/videos/`, registers an analyzed game tag, calls Jockey through `/games/<tag>/highlight-reels`, and writes raw responses to `logs/`. Generated registry data, videos, and logs are ignored by git except `.gitkeep` files.
