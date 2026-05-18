# Sports Jockey Backend

Flask backend for uploading videos to TwelveLabs, creating knowledge stores, indexing assets, querying Jockey, and generating structured sports highlight reels.

## Setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
flask --app app run --port 5000
```

Required environment:

```env
TWELVELABS_API_KEY=
PORT=5000
```

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

### `POST /assets`

Uploads a local file to TwelveLabs using direct upload.

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
  "video_reference_map": {"jockey_video_reference": "match.mp4"},
  "highlight_response_log": "stored_response_log.json",
  "wsc_baseline": {}
}
```

Required: `tag`, `label`, `sport`, `knowledge_store_id`

Returns: registered game object.

### `GET /games`

Lists local analyzed game registrations.

### `GET /games/<tag>`

Returns one local analyzed game registration.

### `POST /games/<tag>/highlight-reels`

Calls Jockey live using the tag's registered `knowledge_store_id`, unless the game has `highlight_response_log`, in which case it returns that stored real response log.

Body:

```json
{
  "match_context": "Optional match context",
  "wsc_baseline": {}
}
```

Returns the same highlight schema as `POST /highlight-reels`.

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
