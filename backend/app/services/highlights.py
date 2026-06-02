import json

from app.core.config import TWELVELABS_MODEL, TWELVELABS_PEGASUS_MODEL
from app.core.errors import ApiError
from app.domain.highlights import HIGHLIGHT_REEL_SCHEMA, highlight_instructions, highlight_prompt, parse_jockey_json
from app.integrations.twelvelabs import analyze_video as twelvelabs_analyze_video
from app.integrations.twelvelabs import create_response as twelvelabs_create_response


HIGHLIGHT_CATEGORY_KEYS = [
    "standard_stats",
    "best_plays",
    "emotional_moments",
    "fan_experience",
    "behind_the_scenes",
]
PEGASUS_CATEGORY_LIMITS = {
    "standard_stats": 6,
    "best_plays": 12,
    "emotional_moments": 12,
    "fan_experience": 10,
    "behind_the_scenes": 10,
}


def generate_highlight_reels(knowledge_store_id, match_context=None, wsc_baseline=None):
    result = twelvelabs_create_response(
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


def generate_pegasus_highlight_reels(asset_contexts, match_context=None, wsc_baseline=None, index_id=None, source_video_name=None):
    if not asset_contexts:
        raise ApiError("Pegasus analysis requires at least one indexed asset", 400)

    analyzed_reels = []
    for asset_context in asset_contexts:
        result = twelvelabs_analyze_video(
            pegasus_analyze_payload(
                asset_context=asset_context,
                match_context=match_context,
                wsc_baseline=wsc_baseline,
                index_id=index_id,
                source_video_name=source_video_name,
            ),
        )
        reels = parse_pegasus_analyze_json(result)
        analyzed_reels.append(normalize_pegasus_asset_reels(reels, asset_context))

    return merge_pegasus_highlight_reels(analyzed_reels, source_video_name)


def pegasus_analyze_payload(asset_context, match_context=None, wsc_baseline=None, index_id=None, source_video_name=None):
    payload = {
        "model_name": TWELVELABS_PEGASUS_MODEL,
        "video": {
            "type": "asset_id",
            "asset_id": asset_context["asset_id"],
        },
        "prompt": pegasus_highlight_prompt(
            asset_context=asset_context,
            match_context=match_context,
            wsc_baseline=wsc_baseline,
            index_id=index_id,
            source_video_name=source_video_name,
        ),
        "temperature": 0.2,
        "response_format": {
            "type": "json_schema",
            "json_schema": pegasus_response_schema(),
        },
        "max_tokens": 12000,
    }
    if asset_context.get("window_start_seconds") is not None and asset_context.get("window_end_seconds") is not None:
        payload["start_time"] = float(asset_context["window_start_seconds"])
        payload["end_time"] = float(asset_context["window_end_seconds"])
    return payload


def pegasus_highlight_prompt(asset_context, match_context=None, wsc_baseline=None, index_id=None, source_video_name=None):
    source_name = source_video_name or asset_context["source_video_name"]
    offset_seconds = float(asset_context.get("offset_seconds") or 0)
    window_start = asset_context.get("window_start_seconds")
    window_end = asset_context.get("window_end_seconds")
    parts = [
        "Generate Workspace highlight reels from this video asset using Pegasus 1.5 analysis only.",
        "Do not use a Jockey knowledge-store response or Jockey chat assumptions.",
        f"Configured TwelveLabs index ID: {index_id or 'not provided'}. Treat this asset as belonging to that index-backed Workspace source.",
        f"Playable source video name: {source_name}.",
        f"Asset being analyzed: {asset_context.get('asset_name') or source_name}.",
        f"Timeline offset that the backend will add for playable source timestamps: {offset_seconds:.3f} seconds.",
        "Return timestamps relative to the analyzed window, with the start of this request treated as 0:00.",
        "Return video_reference exactly as the playable source video name, not the asset id and not the index id.",
        "Generate one intentionally minimal stats baseline and four TwelveLabs/Pegasus-enhanced highlight categories from the footage.",
        "Return exactly these top-level category keys: standard_stats, best_plays, emotional_moments, fan_experience, behind_the_scenes.",
        "standard_stats: minimal WSC-style baseline using only explicit score changes, official stats, final results, race order/status, penalties, cards, fouls, timeouts, substitutions, or other scoreboard/stat-sheet facts visible or audible in the footage. Keep this lane sparse and chronological. Do not include emotion, crowd reaction, replay beauty, player celebration, momentum language, cinematic context, or semantic interpretation in standard_stats.",
        "Prefer only the essential standard_stats events needed to establish the match/race state, with at most 4-6 clips for this lane; if no explicit scoreboard/stat-sheet fact is supported, return an empty standard_stats clips array.",
        "best_plays: game-event plus semantic context, including decisive plays, immediate reactions, celebrations, saves, lead changes, and momentum-defining moments.",
        "emotional_moments: semantic-only clips showing visible emotion, tension, celebration, relief, frustration, heartbreak, or sportsmanship.",
        "fan_experience: semantic-only clips showing crowd roars, fans, signs, chants, stadium atmosphere, broadcast atmosphere, or fan reactions.",
        "behind_the_scenes: semantic-only clips showing warmups, coach reactions, bench moments, huddles, sideline context, pit/garage context, tunnels, or non-gameplay production context.",
        "Every clip must include start_time, end_time, video_reference, clip_type, category, source_type, description, score_context, selection_reason, confidence, explainability_label, evidence_summary, visual_evidence, audio_evidence, transcript_evidence, timeline_rationale, and editorial_use.",
        "Use source_type stats for every standard_stats clip. Use semantic for semantic-only categories, and stats_semantic only in enhanced categories when a clip has both game-event and semantic evidence.",
        "For standard_stats clips, visual_evidence and audio_evidence must be empty arrays. Explain stats clips through score_context, evidence_summary, transcript_evidence when supported, and timeline_rationale only.",
        "Confidence must be 0.01 to 1.0 and reflect how clearly this exact asset supports the timestamp and description.",
        "For explainability, evidence_summary must be one concise sentence grounded in the selected asset. visual_evidence should list visible cues such as scoreboard, body language, players, replays, crowd, bench, or broadcast graphics. audio_evidence should list audible cues such as crowd swell, whistle, commentary, or arena sound when supported. transcript_evidence should list short spoken or OCR/text cues only when present. timeline_rationale should explain why the selected start/end boundaries capture the complete moment. editorial_use should say how to use the clip in a reel.",
        "Choose short playable ranges. Omit clips when evidence is weak. Do not invent timestamps, player names, scores, emotions, standings, or results.",
        "For standard_stats, prefer fewer clips over broad coverage. For each enhanced category, prefer the strongest 4-8 clips rather than exhaustive coverage.",
    ]
    if window_start is not None and window_end is not None:
        parts.append(f"Analyze window on the asset timeline: {float(window_start):.3f}s to {float(window_end):.3f}s.")
    if match_context:
        parts.append(f"Match context: {match_context}")
    if wsc_baseline is not None:
        parts.append(f"WSC baseline reference: {json.dumps(wsc_baseline, ensure_ascii=False)}")
    return "\n".join(parts)


def pegasus_response_schema():
    return strip_unsupported_schema_keywords(HIGHLIGHT_REEL_SCHEMA)


def strip_unsupported_schema_keywords(value):
    if isinstance(value, list):
        return [strip_unsupported_schema_keywords(item) for item in value]
    if not isinstance(value, dict):
        return value

    stripped = {}
    for key, item in value.items():
        if key in {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"}:
            continue
        stripped[key] = strip_unsupported_schema_keywords(item)
    return stripped


def parse_pegasus_analyze_json(result):
    nested_result = result.get("result") if isinstance(result, dict) else None
    if isinstance(nested_result, dict):
        try:
            return parse_pegasus_analyze_json(nested_result)
        except ApiError:
            pass

    for candidate in pegasus_text_candidates(result):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed

    if isinstance(result, dict) and all(key in result for key in HIGHLIGHT_CATEGORY_KEYS):
        return result

    raise ApiError("TwelveLabs Pegasus analysis did not include valid highlight JSON", 502)


def pegasus_text_candidates(result):
    if not isinstance(result, dict):
        return []
    candidates = []
    for key in ("data", "text", "response", "output_text"):
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip())
            event_text = pegasus_event_text(value)
            if event_text:
                candidates.append(event_text)

    output = result.get("output")
    if isinstance(output, str) and output.strip():
        candidates.append(output.strip())
    elif isinstance(output, list):
        for item in output:
            if isinstance(item, str) and item.strip():
                candidates.append(item.strip())
            elif isinstance(item, dict):
                for key in ("data", "text", "content"):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        candidates.append(value.strip())

    return candidates


def pegasus_event_text(value):
    chunks = []
    for line in value.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        text = event.get("text") if isinstance(event, dict) else None
        if isinstance(text, str):
            chunks.append(text)
    return "".join(chunks).strip()


def normalize_pegasus_asset_reels(reels, asset_context):
    if not isinstance(reels, dict):
        raise ApiError("TwelveLabs Pegasus analysis response was not an object", 502)

    normalized = {
        "match_summary": clean_string(reels.get("match_summary")) or f"Pegasus 1.5 analysis for {asset_context['source_video_name']}.",
    }
    offset_seconds = float(asset_context.get("offset_seconds") or 0)

    for category_key in HIGHLIGHT_CATEGORY_KEYS:
        raw_category = reels.get(category_key) if isinstance(reels.get(category_key), dict) else {}
        clips = []
        for raw_clip in raw_category.get("clips", []) if isinstance(raw_category.get("clips"), list) else []:
            if not isinstance(raw_clip, dict):
                continue
            clip = normalize_pegasus_clip(raw_clip, asset_context, offset_seconds, category_key)
            if clip:
                clips.append(clip)

        normalized[category_key] = {
            "title": clean_string(raw_category.get("title")) or default_category_title(category_key),
            "objective": clean_string(raw_category.get("objective")) or default_category_objective(category_key),
            "clips": clips,
            "assembly_notes": normalize_notes(raw_category.get("assembly_notes")),
        }

    return normalized


def normalize_pegasus_clip(raw_clip, asset_context, offset_seconds, category_key):
    start_seconds = seconds_from_timecode(raw_clip.get("start_time"))
    if start_seconds is None:
        return None
    end_seconds = seconds_from_timecode(raw_clip.get("end_time"))
    if end_seconds is None or end_seconds <= start_seconds:
        end_seconds = start_seconds + 12

    source_type = clean_string(raw_clip.get("source_type")) or ("stats" if category_key == "standard_stats" else "semantic")
    if source_type not in {"stats", "semantic", "stats_semantic"}:
        source_type = "stats" if category_key == "standard_stats" else "semantic"

    confidence = raw_clip.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = 0.75
    confidence = min(1, max(0.01, float(confidence)))

    is_standard_stats = category_key == "standard_stats"
    return {
        "start_time": timecode_from_seconds(start_seconds + offset_seconds),
        "end_time": timecode_from_seconds(end_seconds + offset_seconds),
        "video_reference": asset_context["source_video_name"],
        "clip_type": clean_string(raw_clip.get("clip_type")) or category_key,
        "category": clean_string(raw_clip.get("category")) or category_key,
        "source_type": source_type,
        "description": clean_string(raw_clip.get("description")) or "Pegasus-supported video moment.",
        "score_context": clean_string(raw_clip.get("score_context")) or "Context inferred from the analyzed video asset.",
        "selection_reason": clean_string(raw_clip.get("selection_reason")) or "Selected by Pegasus 1.5 from indexed source footage.",
        "confidence": confidence,
        "explainability_label": clean_string(raw_clip.get("explainability_label")) or "Pegasus 1.5 video analysis",
        "evidence_summary": clean_string(raw_clip.get("evidence_summary")) or explainability_summary(raw_clip, category_key),
        "visual_evidence": [] if is_standard_stats else normalize_notes(raw_clip.get("visual_evidence")) or fallback_evidence_list(raw_clip, "description"),
        "audio_evidence": [] if is_standard_stats else normalize_notes(raw_clip.get("audio_evidence")),
        "transcript_evidence": normalize_notes(raw_clip.get("transcript_evidence")),
        "timeline_rationale": clean_string(raw_clip.get("timeline_rationale")) or "The range captures the visible beginning and resolution of the highlighted moment.",
        "editorial_use": clean_string(raw_clip.get("editorial_use")) or default_editorial_use(category_key),
    }


def merge_pegasus_highlight_reels(reel_bodies, source_video_name=None):
    if not reel_bodies:
        raise ApiError("Pegasus analysis returned no highlight reels", 502)

    merged = {
        "match_summary": pegasus_summary(reel_bodies, source_video_name),
    }
    for category_key in HIGHLIGHT_CATEGORY_KEYS:
        first_category = next((body.get(category_key) for body in reel_bodies if isinstance(body.get(category_key), dict)), {})
        clips = []
        notes = []
        for body in reel_bodies:
            category = body.get(category_key, {})
            if not isinstance(category, dict):
                continue
            clips.extend(category.get("clips", []))
            notes.extend(note for note in category.get("assembly_notes", []) if isinstance(note, str) and note.strip())

        clips = sorted(clips, key=lambda clip: seconds_from_timecode(clip.get("start_time")) or 0)
        limit = PEGASUS_CATEGORY_LIMITS.get(category_key)
        if limit:
            clips = clips[:limit]

        merged[category_key] = {
            "title": clean_string(first_category.get("title")) or default_category_title(category_key),
            "objective": clean_string(first_category.get("objective")) or default_category_objective(category_key),
            "clips": clips,
            "assembly_notes": unique_notes(notes) or [f"Generated with {TWELVELABS_PEGASUS_MODEL} from indexed assets."],
        }

    return merged


def pegasus_summary(reel_bodies, source_video_name=None):
    summaries = [
        clean_string(body.get("match_summary"))
        for body in reel_bodies
        if isinstance(body, dict) and clean_string(body.get("match_summary"))
    ]
    if source_video_name:
        prefix = f"{source_video_name} Workspace highlights generated with {TWELVELABS_PEGASUS_MODEL}."
    else:
        prefix = f"Workspace highlights generated with {TWELVELABS_PEGASUS_MODEL}."
    if not summaries:
        return prefix
    return f"{prefix} {' '.join(summaries[:3])}"


def normalize_notes(value):
    if not isinstance(value, list):
        return []
    return [clean_string(item) for item in value if clean_string(item)]


def unique_notes(notes):
    seen = set()
    result = []
    for note in notes:
        normalized = note.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(note)
    return result[:8]


def default_category_title(category_key):
    return {
        "standard_stats": "Event Feed Baseline",
        "best_plays": "Pegasus Best Plays",
        "emotional_moments": "Pegasus Emotional Moments",
        "fan_experience": "Pegasus Fan Experience",
        "behind_the_scenes": "Pegasus Behind the Scenes",
    }.get(category_key, category_key.replace("_", " ").title())


def default_category_objective(category_key):
    return {
        "standard_stats": "Minimal chronological score, result, and stat-sheet context from indexed source footage.",
        "best_plays": "High-value game moments with semantic context.",
        "emotional_moments": "Visible emotional beats grounded in the video.",
        "fan_experience": "Crowd, atmosphere, and broadcast experience moments.",
        "behind_the_scenes": "Bench, sideline, warmup, and non-gameplay context.",
    }.get(category_key, "Pegasus-selected highlight moments.")


def explainability_summary(raw_clip, category_key):
    description = clean_string(raw_clip.get("description"))
    reason = clean_string(raw_clip.get("selection_reason"))
    if description and reason:
        return f"{description} Evidence: {reason}"
    if description:
        return description
    return f"Pegasus 1.5 selected this {category_key.replace('_', ' ')} moment from asset-level visual/audio evidence."


def fallback_evidence_list(raw_clip, key):
    value = clean_string(raw_clip.get(key))
    return [value] if value else []


def default_editorial_use(category_key):
    return {
        "standard_stats": "Use as sparse score/stat context before or after enhanced semantic clips.",
        "best_plays": "Use as a primary highlight beat in the main reel sequence.",
        "emotional_moments": "Use as a reaction or emotional bridge around the related play.",
        "fan_experience": "Use as atmosphere texture before, after, or between key plays.",
        "behind_the_scenes": "Use as contextual setup, transition, or human-interest texture.",
    }.get(category_key, "Use as a supporting highlight beat.")


def clean_string(value):
    return value.strip() if isinstance(value, str) and value.strip() else ""


def seconds_from_timecode(value):
    if not isinstance(value, str) or not value.strip():
        return None
    parts = value.strip().split(":")
    if not 1 <= len(parts) <= 3:
        return None
    total = 0
    for part in parts:
        try:
            number = int(float(part))
        except ValueError:
            return None
        total = total * 60 + number
    return total


def timecode_from_seconds(total_seconds):
    total_seconds = max(0, int(round(total_seconds)))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"
