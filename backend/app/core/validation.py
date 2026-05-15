from flask import request

from app.core.errors import ApiError


def json_body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError("JSON object body is required", 400)
    return body


def required_string(body, key):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{key} is required", 400)
    return value.strip()


def optional_string(body, key):
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{key} must be a non-empty string", 400)
    return value.strip()


def required_dict(body, key):
    value = body.get(key)
    if not isinstance(value, dict):
        raise ApiError(f"{key} must be an object", 400)
    return value


def required_string_dict(body, key):
    value = required_dict(body, key)
    if any(not isinstance(k, str) or not isinstance(v, str) for k, v in value.items()):
        raise ApiError(f"{key} must contain only string keys and values", 400)
    return value


def uploaded_file():
    method = request.form.get("method")
    if method != "direct":
        raise ApiError("method must be direct", 400)
    file = request.files.get("file")
    if file is None or not file.filename:
        raise ApiError("file is required", 400)
    return file
