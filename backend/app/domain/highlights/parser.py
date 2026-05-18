import json

from app.core.errors import ApiError


HIGHLIGHT_CATEGORY_KEYS = [
    "standard_stats",
    "best_plays",
    "emotional_moments",
    "fan_experience",
    "behind_the_scenes",
]


def parse_jockey_json(result):
    for output in result["output"]:
        if output["type"] == "message":
            for content in output["content"]:
                if "text" in content:
                    try:
                        reels = json.loads(content["text"])
                    except json.JSONDecodeError as exc:
                        raise ApiError("TwelveLabs response text was not valid JSON", 502) from exc
                    validate_highlight_confidences(reels, "TwelveLabs response")
                    return reels
    raise ApiError("TwelveLabs response did not include message text", 502)


def validate_highlight_confidences(reels, source_label="highlight response"):
    invalid = []
    for category_key in HIGHLIGHT_CATEGORY_KEYS:
        clips = reels.get(category_key, {}).get("clips", [])
        for index, clip in enumerate(clips):
            confidence = clip.get("confidence")
            if not isinstance(confidence, (int, float)) or confidence <= 0 or confidence > 1:
                invalid.append(f"{category_key}[{index}]={confidence!r}")
    if invalid:
        preview = ", ".join(invalid[:6])
        if len(invalid) > 6:
            preview = f"{preview}, ..."
        raise ApiError(f"{source_label} included clips without usable confidence: {preview}", 502)
