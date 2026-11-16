"""Clip boundaries are set by code, never by the LLM: whole sentences only, inside the length range,
a little breathing room at each end, never cutting into a neighbouring word."""
from .sentences import Sentence

PAD_START = 0.15
PAD_END = 0.35
GAP_GUARD = 0.05


def snap(start_id: int, end_id: int, sents: list[Sentence], length_range: tuple[float, float], duration: float,
         hook_id: int | None = None) -> tuple[float, float] | None:
    n = len(sents)
    if not n:
        return None
    start_id, end_id = sorted((max(0, min(n - 1, start_id)), max(0, min(n - 1, end_id))))
    lo = hook_id if hook_id is not None and start_id <= hook_id <= end_id else start_id  # open on the hook
    hi = end_id
    mn, mx = length_range
    length = lambda: sents[hi].end - sents[lo].start  # noqa: E731
    while length() < mn:
        if hi + 1 < n:
            hi += 1
        elif lo > 0:
            lo -= 1
        else:
            break
    while length() > mx and hi > lo:
        hi -= 1  # trim the tail; the opening (hook) stays
    if length() > mx:
        return None  # one sentence longer than the max clip
    a = sents[lo].start - PAD_START
    if lo > 0:
        a = max(a, sents[lo - 1].end)
    b = sents[hi].end + PAD_END
    if hi + 1 < n:
        b = min(b, sents[hi + 1].start - GAP_GUARD)
    return round(max(0.0, a), 2), round(min(duration, max(b, sents[hi].end)), 2)


def overlap(a: dict, b: dict) -> float:
    """Shared time as a share of the shorter clip (IoU missed 20-of-32 s duplicates: 0.45)."""
    inter = max(0.0, min(a["endSec"], b["endSec"]) - max(a["startSec"], b["startSec"]))
    shorter = min(a["endSec"] - a["startSec"], b["endSec"] - b["startSec"])
    return inter / shorter if shorter > 0 else 0.0


def dedupe(clips: list[dict], limit: float = 0.5) -> list[dict]:
    """Clips sharing ≥ half of the shorter one collapse to the higher-scored one. Result is score-descending."""
    kept: list[dict] = []
    for c in sorted(clips, key=lambda c: -c["score"]):
        if all(overlap(c, k) < limit for k in kept):
            kept.append(c)
    return kept
