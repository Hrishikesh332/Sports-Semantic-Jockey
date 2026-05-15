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
  "reels": [
    {"id": "scoring_plays", "clips": []},
    {"id": "emotional_rollercoaster", "clips": []},
    {"id": "fan_experience", "clips": []}
  ]
}
```

## Smoke Test

```bash
python3 scripts/olympics_smoke_test.py
```

The smoke test reads local videos from `data/videos/` and writes raw responses to `logs/`. Both folders are ignored by git, except `data/videos/.gitkeep`.
