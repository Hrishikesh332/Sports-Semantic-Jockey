import requests

from app.core.config import REQUEST_TIMEOUT_SECONDS, TWELVELABS_BASE_URL, UPLOAD_TIMEOUT_SECONDS, twelvelabs_api_key
from app.core.errors import ApiError


def json_headers():
    api_key = twelvelabs_api_key()
    if not api_key:
        raise ApiError("TWELVELABS_API_KEY is required", 500)
    return {"x-api-key": api_key, "Content-Type": "application/json"}


def file_headers():
    api_key = twelvelabs_api_key()
    if not api_key:
        raise ApiError("TWELVELABS_API_KEY is required", 500)
    return {"x-api-key": api_key}


def request_json(method, path, payload=None):
    try:
        response = requests.request(
            method,
            f"{TWELVELABS_BASE_URL}{path}",
            headers=json_headers(),
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise ApiError(str(exc), 502) from exc

    return parse_response(response)


def upload_asset(file):
    content = file.read()
    if not content:
        raise ApiError("file is empty", 400)

    try:
        response = requests.post(
            f"{TWELVELABS_BASE_URL}/assets",
            headers=file_headers(),
            files=[
                ("method", (None, "direct")),
                ("enable_hls", (None, "true")),
                ("enable_thumbnail", (None, "true")),
                ("file", (file.filename, content, file.mimetype or "application/octet-stream")),
            ],
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise ApiError(str(exc), 502) from exc

    return parse_response(response)


def parse_response(response):
    try:
        data = response.json()
    except ValueError as exc:
        raise ApiError(response.text, response.status_code if response.status_code >= 400 else 502) from exc

    if response.status_code >= 400:
        raise ApiError(data, response.status_code)

    return data
