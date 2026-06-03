import json
import os


TWELVELABS_BASE_URL = "https://api.twelvelabs.io/v1.3"
TWELVELABS_MODEL = "jockey1.0"
TWELVELABS_PEGASUS_MODEL = os.environ.get("TWELVELABS_PEGASUS_MODEL", "pegasus1.5")
REQUEST_TIMEOUT_SECONDS = int(os.environ.get("TWELVELABS_REQUEST_TIMEOUT_SECONDS", "900"))
UPLOAD_TIMEOUT_SECONDS = 900


def twelvelabs_api_key():
    return os.environ.get("TWELVELABS_API_KEY")


def twelvelabs_index_id():
    return os.environ.get("INDEX_ID", "").strip()


def knowledge_store_id():
    return os.environ.get("KNOWLEDGE_STORE_ID", "").strip()


def default_game_tag():
    return os.environ.get("DEFAULT_GAME_TAG", "sports").strip() or "sports"


def default_game_label():
    return os.environ.get("DEFAULT_GAME_LABEL", "Sports").strip() or "Sports"


def default_game_sport():
    return os.environ.get("DEFAULT_GAME_SPORT", "Sports").strip() or "Sports"


def env_default_game():
    store_id = knowledge_store_id()
    if not store_id:
        return None
    game = {
        "tag": default_game_tag(),
        "label": default_game_label(),
        "sport": default_game_sport(),
        "knowledge_store_id": store_id,
    }
    index_id = twelvelabs_index_id()
    if index_id:
        game["marengo_index_id"] = index_id
    return game


def port():
    return int(os.environ.get("PORT", "5000"))


def cors_allowed_origins():
    raw_origins = os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "https://sports-semantic-jockey.vercel.app,http://localhost:5173,http://127.0.0.1:5173",
    )
    return [origin.strip().rstrip("/") for origin in raw_origins.split(",") if origin.strip()]


def app_url():
    return (
        os.environ.get("APP_URL", "").strip().rstrip("/")
        or os.environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
    )


def keep_alive_enabled():
    value = os.environ.get("KEEP_ALIVE_ENABLED", "true").strip().lower()
    return value not in {"0", "false", "no", "off"}


def keep_alive_interval_minutes():
    return max(1, int(os.environ.get("KEEP_ALIVE_INTERVAL_MINUTES", "9")))


def keep_alive_timeout_seconds():
    return max(1, int(os.environ.get("KEEP_ALIVE_TIMEOUT_SECONDS", "15")))


def default_game_registrations():
    raw_value = os.environ.get("DEFAULT_GAME_REGISTRATIONS_JSON", "").strip()
    registrations = []
    if raw_value:
        try:
            parsed = json.loads(raw_value)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            registrations = [parsed]
        elif isinstance(parsed, list):
            registrations = [game for game in parsed if isinstance(game, dict)]
    if not registrations:
        env_game = env_default_game()
        if env_game:
            registrations = [env_game]
    return registrations


def keep_alive_url():
    explicit_url = os.environ.get("KEEP_ALIVE_URL", "").strip()
    if explicit_url:
        return explicit_url

    base_url = app_url()
    if not base_url:
        return None

    path = os.environ.get("KEEP_ALIVE_PATH", "/health").strip()
    if not path:
        return base_url
    return f"{base_url}/{path.lstrip('/')}"
