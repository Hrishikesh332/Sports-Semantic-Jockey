import json


def highlight_instructions():
    return (
        "You are a senior sports highlight producer using TwelveLabs Jockey over a knowledge store. "
        "Use only evidence from the indexed match footage. Build accurate timestamped highlight categories, keep the stats baseline sparse and factual, "
        "and add semantic context only when the footage supports it. Return JSON only."
    )


def highlight_prompt(match_context, wsc_baseline):
    parts = [
        "Generate one intentionally minimal stats baseline and four TwelveLabs-enhanced highlight categories from the same match footage.",
        "Return exactly these top-level category keys: standard_stats, best_plays, emotional_moments, fan_experience, behind_the_scenes.",
        "standard_stats: minimal WSC-style baseline using only explicit score changes, official stats, final results, race order/status, penalties, cards, fouls, timeouts, substitutions, or other scoreboard/stat-sheet facts visible or audible in the footage. Keep this lane sparse and chronological. Do not include emotion, crowd reaction, replay beauty, player celebration, momentum language, cinematic context, or semantic interpretation in standard_stats.",
        "Prefer only the essential standard_stats events needed to establish the match/race state, with at most 4-6 clips for this lane; if no explicit scoreboard/stat-sheet fact is supported, return an empty standard_stats clips array.",
        "best_plays: stats plus semantic context, including scoring events, immediate reactions, celebrations, and momentum-defining plays.",
        "emotional_moments: semantic-only clips showing tears, hugs, heartbreak, fist pumps, intense relief, disappointment, tension, or celebration.",
        "fan_experience: semantic-only clips showing crowd roars, signs, face-painted fans, chants, stadium atmosphere, or fan reactions.",
        "behind_the_scenes: semantic-only clips showing warmups, coach reactions, bench camaraderie, tunnel walks, huddles, or sideline context.",
        "For full-match or long-form source videos, cover the complete story arc. Do not cluster enhanced categories only in the opening minutes. When evidence exists, include representative early, middle, and late clips, especially late score swings, final-result moments, fourth-quarter/second-half pressure, and post-result reactions.",
        "If standard_stats contains events deep into the source video, best_plays should also include later confirmed events with visible reaction, replay, crowd, bench, or momentum context when supported by the footage.",
        "Every clip must include start_time, end_time, video_reference, clip_type, category, source_type, description, score_context, selection_reason, confidence, explainability_label, evidence_summary, visual_evidence, audio_evidence, transcript_evidence, timeline_rationale, and editorial_use.",
        "For every included clip, confidence must be a calibrated evidence confidence from 0.01 to 1.0 based on how clearly the indexed footage supports that exact timestamp, description, source type, and score context. Never return 0 for an included clip; if confidence cannot be supported, omit the clip.",
        "Use source_type stats for every standard_stats clip. Use semantic for semantic-only categories, and stats_semantic only in enhanced categories when a clip has both game-event and semantic evidence.",
        "For standard_stats clips, visual_evidence and audio_evidence must be empty arrays. Explain stats clips through score_context, evidence_summary, transcript_evidence when supported, and timeline_rationale only.",
        "Use explainability_label values like Stats Event: Goal, Stats Event: Touchdown, Semantic Detection: High-confidence celebration, or Semantic Detection: Crowd roar.",
        "For explainability, evidence_summary must be one concise sentence; visual_evidence, audio_evidence, and transcript_evidence must be short evidence lists with empty arrays when not supported; timeline_rationale must explain why this exact range starts and ends where it does; editorial_use must explain where the clip belongs in an edited reel.",
        "Do not invent clips, timestamps, players, scores, emotions, unsupported confidence values, or video references.",
        "If a category does not have usable evidence, return an empty clips array for that category.",
    ]
    if match_context:
        parts.append(f"Match context: {match_context}")
    if wsc_baseline is not None:
        parts.append(f"WSC baseline reference: {json.dumps(wsc_baseline, ensure_ascii=False)}")
    return "\n".join(parts)
