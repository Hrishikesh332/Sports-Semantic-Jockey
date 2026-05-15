import os


TWELVELABS_BASE_URL = "https://api.twelvelabs.io/v1.3"
TWELVELABS_MODEL = "jockey1.0"
REQUEST_TIMEOUT_SECONDS = 120
UPLOAD_TIMEOUT_SECONDS = 900


def twelvelabs_api_key():
    return os.environ.get("TWELVELABS_API_KEY")


def port():
    return int(os.environ.get("PORT", "5000"))
