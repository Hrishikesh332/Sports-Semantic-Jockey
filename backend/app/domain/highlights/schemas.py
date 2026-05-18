SPORTS_HIGHLIGHT_INGESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "score_changes": {
            "type": "array",
            "description": "Every scoring event in chronological order",
            "items": {
                "type": "object",
                "description": "A scoring event",
                "properties": {
                    "timestamp": {"type": "string", "description": "When the scoring event starts"},
                    "team": {"type": "string", "description": "Team that scored"},
                    "score_after_play": {"type": "string", "description": "Score after the scoring event"},
                    "play_description": {"type": "string", "description": "What happened in the scoring play"},
                    "players_involved": {
                        "type": "array",
                        "description": "Players directly involved in the scoring play",
                        "items": {"type": "string", "description": "Player name, number, or visible identifier"},
                    },
                },
            },
        },
        "key_plays": {
            "type": "array",
            "description": "Important non-scoring plays that change momentum or explain scoring context",
            "items": {
                "type": "object",
                "description": "A key play",
                "properties": {
                    "timestamp": {"type": "string", "description": "When the key play starts"},
                    "play_type": {"type": "string", "description": "Type of play"},
                    "outcome": {"type": "string", "description": "Result of the play"},
                    "context": {"type": "string", "description": "Why the play matters to the match story"},
                },
            },
        },
        "emotional_moments": {
            "type": "array",
            "description": "Celebrations, disappointment, bench reactions, player emotion, and tension",
            "items": {
                "type": "object",
                "description": "An emotional match moment",
                "properties": {
                    "timestamp": {"type": "string", "description": "When the emotional moment starts"},
                    "emotion": {"type": "string", "description": "Dominant emotion shown"},
                    "subjects": {"type": "string", "description": "Who or what is shown"},
                    "match_context": {"type": "string", "description": "How this moment connects to the game"},
                },
            },
        },
        "fan_reactions": {
            "type": "array",
            "description": "Crowd, fan, stadium, mascot, broadcast, and atmosphere moments",
            "items": {
                "type": "object",
                "description": "A fan or atmosphere moment",
                "properties": {
                    "timestamp": {"type": "string", "description": "When the fan moment starts"},
                    "reaction": {"type": "string", "description": "Visible or audible reaction"},
                    "visual_context": {"type": "string", "description": "What is visible in the shot"},
                    "connected_play": {"type": "string", "description": "The nearby play or story beat it supports"},
                },
            },
        },
        "broadcast_context": {
            "type": "array",
            "description": "Scoreboard shots, replays, graphics, announcer cues, and contextual footage",
            "items": {
                "type": "object",
                "description": "A broadcast context moment",
                "properties": {
                    "timestamp": {"type": "string", "description": "When the context moment starts"},
                    "context_type": {"type": "string", "description": "Type of broadcast or contextual cue"},
                    "details": {"type": "string", "description": "Details visible or audible in the footage"},
                },
            },
        },
    },
}

HIGHLIGHT_CLIP_SCHEMA = {
    "type": "object",
    "properties": {
        "start_time": {"type": "string"},
        "end_time": {"type": "string"},
        "video_reference": {"type": "string"},
        "clip_type": {"type": "string"},
        "category": {"type": "string"},
        "source_type": {"type": "string", "enum": ["stats", "semantic", "stats_semantic"]},
        "description": {"type": "string"},
        "score_context": {"type": "string"},
        "selection_reason": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0.01, "maximum": 1},
        "explainability_label": {"type": "string"},
    },
    "required": [
        "start_time",
        "end_time",
        "video_reference",
        "clip_type",
        "category",
        "source_type",
        "description",
        "score_context",
        "selection_reason",
        "confidence",
        "explainability_label",
    ],
    "additionalProperties": False,
}

HIGHLIGHT_CATEGORY_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "objective": {"type": "string"},
        "clips": {
            "type": "array",
            "items": HIGHLIGHT_CLIP_SCHEMA,
        },
        "assembly_notes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "objective", "clips", "assembly_notes"],
    "additionalProperties": False,
}

HIGHLIGHT_REEL_SCHEMA = {
    "type": "object",
    "properties": {
        "match_summary": {"type": "string"},
        "standard_stats": HIGHLIGHT_CATEGORY_SCHEMA,
        "best_plays": HIGHLIGHT_CATEGORY_SCHEMA,
        "emotional_moments": HIGHLIGHT_CATEGORY_SCHEMA,
        "fan_experience": HIGHLIGHT_CATEGORY_SCHEMA,
        "behind_the_scenes": HIGHLIGHT_CATEGORY_SCHEMA,
    },
    "required": [
        "match_summary",
        "standard_stats",
        "best_plays",
        "emotional_moments",
        "fan_experience",
        "behind_the_scenes",
    ],
    "additionalProperties": False,
}
