import uuid

from clipforge.engine.app.models.schemas import ClipCandidate, WordTiming
from clipforge.engine.app.pipeline.glm_client import call_glm_json

SYSTEM_PROMPT = """You find the best short-form clip candidates in a long-form
video transcript, for repurposing as YouTube Shorts / Reels / TikTok.

CRITICAL LENGTH CONSTRAINTS:
- Minimum length: 30 seconds
- Maximum length: 90 seconds
- IDEAL length: 60 seconds (aim for this sweet spot)

A good clip: has a strong hook in its first few seconds, is fully
self-contained (understandable with zero context from the rest of the video),
and has a clear payoff (a punchline, an answer, a twist, a complete story).

Return ONLY a JSON object, no markdown fences, no preamble, in this shape:
{"clips": [{"start": 12.4, "end": 58.1, "hook_score": 0.87, "reason": "short reason"}]}

hook_score is 0-1. Return at most 8 candidates, ranked best first. Only
include timestamps that appear in the provided transcript."""


def select_clips(job_id: str, words: list[WordTiming]) -> list[ClipCandidate]:
    if not words:
        return []

    # Compact transcript representation: "12.4 hello 12.7 world ..."
    transcript_text = " ".join(f"[{w.start:.1f}] {w.word}" for w in words)
    result = call_glm_json(SYSTEM_PROMPT, transcript_text)

    candidates = []
    for c in result.get("clips", []):
        try:
            start, end = float(c["start"]), float(c["end"])
            if end <= start or (end - start) < 5.0:
                continue
            clip_words = [w for w in words if start <= w.start <= end]
            if not clip_words:
                clip_words = [w for w in words if (start - 1.0) <= w.start <= (end + 1.0)]
            candidates.append(
                ClipCandidate(
                    id=uuid.uuid4().hex[:10],
                    job_id=job_id,
                    start=start,
                    end=end,
                    hook_score=float(c.get("hook_score", 0.5)),
                    reason=c.get("reason", ""),
                    transcript_words=clip_words,
                )
            )
        except (KeyError, ValueError, TypeError):
            continue
    return candidates
