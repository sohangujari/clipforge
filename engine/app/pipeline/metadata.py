from clipforge.engine.app.models.schemas import ClipCandidate
from clipforge.engine.app.pipeline.glm_client import call_glm_json

SYSTEM_PROMPT = """You write YouTube Shorts titles, descriptions, and tags
optimized for discovery. Title: under 60 characters, curiosity-driven hook,
no clickbait that isn't paid off by the clip. Description: 1-3 sentences
plus 3-5 relevant hashtags including #shorts. Tags: 8-12 short keyword
phrases a viewer might search for.

Return ONLY a JSON object, no markdown fences, no preamble:
{"title": "...", "description": "...", "tags": ["...", "..."]}"""


def generate_metadata(clip: ClipCandidate) -> dict:
    clip_text = " ".join(w.word for w in clip.transcript_words)
    result = call_glm_json(SYSTEM_PROMPT, f"Clip transcript: {clip_text}\n\nWhy this clip was picked: {clip.reason}")
    return {
        "title": result.get("title", ""),
        "description": result.get("description", ""),
        "tags": result.get("tags", []),
    }
