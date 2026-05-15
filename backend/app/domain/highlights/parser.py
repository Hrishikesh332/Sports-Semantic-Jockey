import json

from app.core.errors import ApiError


def parse_jockey_json(result):
    for output in result["output"]:
        if output["type"] == "message":
            for content in output["content"]:
                if "text" in content:
                    try:
                        return json.loads(content["text"])
                    except json.JSONDecodeError as exc:
                        raise ApiError("TwelveLabs response text was not valid JSON", 502) from exc
    raise ApiError("TwelveLabs response did not include message text", 502)
