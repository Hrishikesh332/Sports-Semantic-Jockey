from flask import request

from app.core.config import cors_allowed_origins


def register_cors(app):
    @app.after_request
    def add_cors_headers(response):
        allowed_origins = cors_allowed_origins()
        request_origin = request.headers.get("Origin", "").rstrip("/")

        if "*" in allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = "*"
        elif request_origin and request_origin in allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = request_origin
            response.headers.add("Vary", "Origin")

        response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        response.headers.setdefault(
            "Access-Control-Allow-Headers",
            request.headers.get("Access-Control-Request-Headers") or "Content-Type, Authorization",
        )
        response.headers.setdefault("Access-Control-Max-Age", "86400")
        return response
