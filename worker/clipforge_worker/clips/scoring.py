"""The overall viral score is computed here, in code — never by the LLM — so it's consistent and explainable."""
import json
from pathlib import Path

WEIGHTS = json.loads((Path(__file__).parent / "weights.json").read_text())
BASE = ("hook", "emotion", "value", "pacing", "trend")
REACTIONS = ("laughter", "applause", "cheering", "scream")


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def fuse(dims: dict, feats: dict, content_type: str) -> tuple[float, dict]:
    """LLM dimension scores + audio signal z-scores → (overall 0–100, breakdown for the UI)."""
    w = WEIGHTS.get(content_type, WEIGHTS["default"])
    reaction_z = max((feats.get(k, 0.0) for k in REACTIONS), default=0.0)
    boost = (6 * _clamp(reaction_z / 4) + 3 * _clamp(feats.get("energy", 0.0) / 4)  # real audience reaction is evidence…
             + 6 * _clamp(feats.get("chat", 0.0) / 4))  # …and so is chat blowing up
    b = {k: float(dims.get(k, 50)) for k in BASE}
    b["emotion"] = min(100.0, b["emotion"] + boost)
    extra = {k: float(v) for k, v in (dims.get("extra") or {}).items()}
    if "reaction" in (w.get("extra") or {}):
        extra["reaction"] = min(100.0, extra.get("reaction", b["emotion"]) + boost)
    total = wsum = 0.0
    for k in BASE:
        total += w[k] * b[k]; wsum += w[k]
    for k, wk in (w.get("extra") or {}).items():
        total += wk * extra.get(k, 50.0); wsum += wk
    overall = round(_clamp(total / wsum, 0, 100), 1)
    used = [k for k in REACTIONS if feats.get(k, 0.0) >= 3] + (["loud"] if feats.get("energy", 0.0) >= 3 else []) + (["chat"] if feats.get("chat", 0.0) >= 3 else [])
    return overall, {**{k: round(v) for k, v in b.items()}, "extra": {k: round(v) for k, v in extra.items()}, "signals_used": used}
