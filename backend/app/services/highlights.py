from app.core.config import TWELVELABS_MODEL
from app.domain.highlights import HIGHLIGHT_REEL_SCHEMA, highlight_instructions, highlight_prompt, parse_jockey_json
from app.integrations.twelvelabs import request_json


def generate_highlight_reels(knowledge_store_id, match_context=None, wsc_baseline=None):
    result = request_json(
        "post",
        "/responses",
        {
            "model": TWELVELABS_MODEL,
            "instructions": highlight_instructions(),
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": highlight_prompt(match_context, wsc_baseline),
                }
            ],
            "knowledge_store_id": knowledge_store_id,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "highlight_reels",
                    "schema": HIGHLIGHT_REEL_SCHEMA,
                }
            },
        },
    )
    return parse_jockey_json(result)
