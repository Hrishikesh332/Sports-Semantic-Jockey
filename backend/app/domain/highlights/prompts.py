import json


def highlight_instructions():
    return (
        "You are a senior sports highlight producer. Use only evidence from the indexed match footage. "
        "Build accurate timestamped reels, keep scoring coverage complete, and add emotional context only when the footage supports it. "
        "Return JSON only."
    )


def highlight_prompt(match_context, wsc_baseline):
    parts = [
        "Generate three distinct highlight reels from the same match footage.",
        "Create exactly these reel ids: scoring_plays, emotional_rollercoaster, fan_experience.",
        "The scoring_plays reel must include every scoring play in chronological order and preserve score context.",
        "The emotional_rollercoaster reel must include scoring plays plus celebrations, reactions, momentum swings, disappointment, and tension.",
        "The fan_experience reel must prioritize fans, crowd noise, stadium atmosphere, bench reactions, broadcast cutaways, and the scoring moments they support.",
        "Do not invent clips, timestamps, players, scores, or video references.",
        "If a contextual clip does not have usable evidence, omit it.",
    ]
    if match_context:
        parts.append(f"Match context: {match_context}")
    if wsc_baseline is not None:
        parts.append(f"WSC baseline reference: {json.dumps(wsc_baseline, ensure_ascii=False)}")
    return "\n".join(parts)
