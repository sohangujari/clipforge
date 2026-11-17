"""Finding clips: transcript + audio signals → LLM highlight candidates → sentence-snapped bounds → scores → titles.
The LLM only ever picks sentence ids; timing, length, dedupe and the overall score are decided in code."""
import json
import logging
import time
import uuid

from .. import chat as CHAT
from .. import signals as SIG
from ..clips.boundaries import dedupe, overlap, snap
from ..clips.scoring import fuse
from ..clips.sentences import split_sentences
from ..clips.taste import examples as taste_examples
from ..clips.windows import windows
from ..db import now_iso
from ..llm import LlmError, LlmTimeout, LlmUnavailable, QuotaExhausted, RateLimited, call_llm_ex
from ..media import ffmpeg

log = logging.getLogger("clipforge.worker")

CLOUD_WINDOW = (25_000, 500)        # whole transcript in one call for up to ~2 h of speech
LOCAL_WINDOW = (900, 100)           # small local models: stay inside an 8K context
CLOUD_BATCH, LOCAL_BATCH = 12, 4
LOCAL_MAX_SCORED = 6   # a local 4B model writes ~10 tokens/s: scoring 10 candidates took 8.5 min on an 8 GB M3
MAX_RETRIES = 5
AUTO_MIN, AUTO_MAX, AUTO_SCORE = 3, 12, 60
NO_MODEL = "Set a model in Settings → AI to find clips"
CUE_Z = 3.0


def _fmt(t: float) -> str:
    return f"{int(t) // 60}:{int(t) % 60:02d}"


class Llm:
    """call_llm_ex with visible rate-limit waits and a sticky daily-quota stop."""

    def __init__(self, ctx, provider: str = "your AI provider"):
        self.ctx, self.provider, self.quota_msg = ctx, provider, None
        self.frac = 0.0

    def __call__(self, task: str, payload: dict) -> dict | None:
        if self.quota_msg:
            return None
        for _ in range(MAX_RETRIES):
            try:
                return call_llm_ex(task, payload)[0]
            except RateLimited as r:
                what = f"{self.provider} is busy" if r.busy else f"Rate limited by {self.provider}"
                wait = max(0, int(r.retry_after))
                for left in range(wait, 0, -1):
                    self.ctx.report(self.frac, f"{what} — retrying in {left}s")
                    time.sleep(1)
                self.ctx.report(self.frac, f"{what} — retrying")
            except QuotaExhausted as q:
                self.quota_msg = str(q)
                return None
        raise LlmError("still rate limited after several retries")


def _cues(sents, sig: dict) -> dict[int, list[str]]:
    cues: dict[int, list[str]] = {}
    if not sig.get("hop"):
        return cues

    def at(t: float, name: str) -> None:
        for s in sents:  # the sentence the reaction follows (reactions trail the line by up to 2 s)
            if s.start <= t <= s.end + SIG.REACTION_TRAIL_S:
                lst = cues.setdefault(s.id, [])
                if name not in lst:
                    lst.append(name)
                return
    for kind, name in (("laughter", "laughter"), ("applause", "applause"), ("cheering", "cheering"), ("scream", "scream"),
                       ("chat", "chat spike"), ("chat_funny", "chat laughing"), ("chat_hype", "chat hype")):
        for t, _z in SIG.peaks(sig, kind, z_min=CUE_Z):
            at(t, name)
    for s in sents:
        f = SIG.segment_features(sig, s.start, max(s.start, s.end - SIG.REACTION_TRAIL_S))
        if f["energy"] >= 2.5:
            cues.setdefault(s.id, []).append("loud")
        if f["pace"] >= 2.5:
            cues.setdefault(s.id, []).append("fast")
    return {k: v[:5] for k, v in cues.items()}  # the prompt schema takes ≤ 5 per sentence


def _text(words: list[dict], a: float, b: float) -> str:
    return " ".join(w["w"] for w in words if w["s"] >= a - 0.05 and w["e"] <= b + 0.05)


def _match(items: list, n: int, base: int) -> list:
    """Line up model results with our clips. Small models rename keys ('0' → 'clip_0' or 'hook'), so use the
    number inside the key when it's one of ours, else the position when the count matches."""
    import re
    by_key = {}
    for it in items:
        m = re.search(r"\d+", str(it.get("key", "")))
        if m and base <= int(m.group()) < base + n:
            by_key.setdefault(int(m.group()) - base, it)
    if len(by_key) == n:
        return [by_key[k] for k in range(n)]
    if len(items) == n:
        return list(items)
    return [by_key.get(k) for k in range(n)]


def _fallback_meta(c: dict) -> dict:
    t = (c["why"] or "Clip")[:57]
    return {"titles": [t, t, t], "descriptions": {"shorts": t, "tiktok": t, "reels": t}, "hashtags": ["#shorts", "#clips", "#viral", "#fyp", "#reels"]}


def run(ctx) -> None:
    md = ctx.media_dir
    words = json.loads((md / "transcript.json").read_text())["words"]
    sents = split_sentences(words)
    sig = json.loads((md / "signals.json").read_text()) if (md / "signals.json").exists() else {}
    CHAT.ensure(md)  # an imported chat file
    if sig.get("hop"):
        sig.update(CHAT.signal(md, sig["hop"], len(sig.get("rms_db", []))))
    s = ctx.settings
    length_range = tuple(s.get("lengthRange") or (30, 90))
    duration = float(ctx.project.get("durationSec") or (words[-1]["e"] if words else 0))
    ctype = ctx.project.get("contentType") or "auto"
    detect = ctype == "auto"
    warnings: list[str] = []

    try:
        info = call_llm_ex("info", {})[0]
    except LlmUnavailable:
        info = {"local": True, "provider": None}
    local = bool(info.get("local"))
    llm = Llm(ctx, {"google": "Google", "openai": "OpenAI", "anthropic": "Anthropic", "ollama": "Ollama", "cloudflare": "Cloudflare"}.get(info.get("provider") or "", "your AI provider"))
    batch = LOCAL_BATCH if local else CLOUD_BATCH
    cue_map = _cues(sents, sig)
    taste = taste_examples(ctx.conn, ctype if not detect else "podcast", *((2, 200) if local else ()))  # local: fit a 4K context

    # 1. Highlight candidates, window by window.
    wins = windows(sents, *(LOCAL_WINDOW if local else CLOUD_WINDOW))
    cands, skipped = [], 0
    for i, win in enumerate(wins):
        llm.frac = 0.6 * i / len(wins)
        ctx.report(llm.frac, f"Finding clips · part {i + 1} of {len(wins)}" if len(wins) > 1 else "Finding clips")
        payload = {"contentType": "custom" if detect else ctype, "detectType": detect, "tone": s.get("tone", "neutral"),
                   "lengthRange": list(length_range), "examples": taste, "max": 4 if local else 12,
                   "sentences": [{"id": x.id, "t": _fmt(x.start), "text": x.text, "cues": cue_map.get(x.id, [])} for x in win.sentences]}
        try:
            try:
                out = llm("highlights", payload)
            except (LlmTimeout, RateLimited, QuotaExhausted, LlmUnavailable):
                raise
            except LlmError as e:  # one retry: free tiers return the occasional 503/overload or malformed answer
                log.info("highlights part %d/%d failed (%s), retrying once", i + 1, len(wins), e)
                out = llm("highlights", payload)
        except LlmUnavailable as e:
            if "no_model" in str(e) and not cands:
                ctx.set_project(warning=NO_MODEL)
                ctx.report(1.0)
                return
            skipped += 1  # web app hiccup: keep what we have
            continue
        except LlmError as e:
            log.warning("highlights part %d/%d skipped: %s", i + 1, len(wins), e)
            skipped += 1  # timeout, bad JSON, provider error: skip this part only
            continue
        if out is None:
            break  # daily quota
        if detect and out.get("contentType"):
            ctype, detect = out["contentType"], False
            ctx.set_project(contentType=ctype)
        ids = {x.id for x in win.sentences}
        for c in out.get("candidates", []):
            if c["startId"] not in ids or c["endId"] not in ids:
                continue  # out of range / hallucinated ids
            cand = candidate(c, sents, cue_map, length_range, duration)
            if cand:
                cands.append(cand)
    if skipped:
        warnings.append(f"{skipped} of {len(wins)} parts couldn't be analysed")
    cands = dedupe(cands)
    reviewed = ctx.conn.execute("SELECT startSec, endSec FROM Clip WHERE projectId=? AND (status!='new' OR edit IS NOT NULL)", (ctx.job.project_id,)).fetchall()
    cands = [c for c in cands if all(overlap(c, {"startSec": a, "endSec": b}) < 0.5 for a, b in reviewed)]  # kept stays once, deleted stays gone

    if local:
        cands = cands[:LOCAL_MAX_SCORED]  # dedupe() ordered them: most audio cues first, then the model's own order
    score_candidates(ctx, llm, cands, words, sig, ctype, batch, brief=local)

    # 3. Choose: auto = everything ≥ 60 (at least 3, at most 12); a number = the top N.
    ranked = sorted(cands, key=lambda c: -c["score"])
    count = s.get("clipCount", "auto")
    if count == "auto":
        chosen = [c for c in ranked if c["score"] >= AUTO_SCORE][:AUTO_MAX]
        if len(chosen) < AUTO_MIN:
            chosen = ranked[:AUTO_MIN]
    else:
        chosen = ranked[:int(count)]

    write_metadata(ctx, llm, chosen, words, ctype, batch)
    if llm.quota_msg:
        warnings.append(llm.quota_msg)

    # 5. Replace this project's previous unreviewed auto clips; keep the ones the user kept.
    if not chosen and (skipped or llm.quota_msg):  # an error, not an empty video: don't throw away the last good run
        warnings.append("nothing new was found, so ClipForge kept your previous clips — try Find clips again")
    else:
        ctx.conn.execute("DELETE FROM Clip WHERE projectId=? AND source='auto' AND status='new' AND edit IS NULL", (ctx.job.project_id,))
        insert_clips(ctx, chosen, "auto")
    try:
        call_llm_ex("unload", {})  # give the local model's memory back
    except LlmError:
        pass
    ctx.set_project(warning="; ".join(warnings) or None)
    ctx.report(1.0)


def score_candidates(ctx, llm, cands: list, words: list, sig: dict, ctype: str, batch: int, base: float = 0.6, span: float = 0.25, brief: bool = False) -> None:
    """Batched LLM scores fused with audio signals in code. Sets score/breakdown/reason/tips/signals on each candidate."""
    for n in range(0, len(cands), batch):
        part = cands[n:n + batch]
        llm.frac = base + span * n / max(1, len(cands))
        ctx.report(llm.frac, "Scoring clips")
        try:
            out = llm("score", {"contentType": ctype if ctype != "auto" else "custom", "brief": brief,
                                "clips": [{"key": str(n + k), "text": _text(words, c["startSec"], c["endSec"]), "cues": c["cues"]} for k, c in enumerate(part)]})
        except LlmError:
            out = None
        got = _match((out or {}).get("scores", []), len(part), n)
        for k, c in enumerate(part):
            d = got[k] or {"hook": 50, "emotion": 50, "value": 50, "pacing": 50, "trend": 50, "extra": {},
                                        "reasons": {}, "summary": c["why"], "tips": []}
            feats = SIG.segment_features(sig, c["startSec"], c["endSec"]) if sig.get("hop") else {}
            c["score"], c["breakdown"] = fuse(d, feats, ctype)
            c["breakdown"]["reasons"] = d.get("reasons", {})
            c["reason"], c["tips"], c["signals"] = d.get("summary") or c["why"], d.get("tips", []), feats


def write_metadata(ctx, llm, chosen: list, words: list, ctype: str, batch: int, base: float = 0.85, span: float = 0.15) -> None:
    """Batched titles, descriptions and hashtags; fallbacks keep a clip usable if the model fails."""
    s = ctx.settings
    language = json.loads((ctx.media_dir / "transcript.json").read_text()).get("language") or "en"
    for n in range(0, len(chosen), batch):
        part = chosen[n:n + batch]
        llm.frac = base + span * n / max(1, len(chosen))
        ctx.report(llm.frac, "Writing titles")
        try:
            out = llm("metadata", {"contentType": ctype if ctype != "auto" else "custom", "tone": s.get("tone", "neutral"), "language": language,
                                   "clips": [{"key": str(n + k), "text": _text(words, c["startSec"], c["endSec"])} for k, c in enumerate(part)]})
        except LlmError:
            out = None
        got = _match((out or {}).get("items", []), len(part), n)
        for k, c in enumerate(part):
            c["meta"] = got[k] or _fallback_meta(c)


def insert_clips(ctx, chosen: list, source: str, query: str | None = None) -> None:
    md, pid = ctx.media_dir, ctx.job.project_id
    (md / "clips").mkdir(exist_ok=True)
    for c in chosen:
        cid = str(uuid.uuid4())
        m = c["meta"]
        ctx.conn.execute(
            "INSERT INTO Clip (id, projectId, startSec, endSec, score, breakdown, reason, tips, titles, descriptions, hashtags, hook, keywords, signals, source, query, status, createdAt) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'new', ?)",
            (cid, pid, c["startSec"], c["endSec"], c["score"], json.dumps(c["breakdown"]), c["reason"][:300], json.dumps(c["tips"]),
             json.dumps(list(m["titles"])), json.dumps(m["descriptions"]), json.dumps(m["hashtags"]),
             m.get("hook") or None, json.dumps(m["keywords"]) if m.get("keywords") else None, json.dumps(c["signals"]), source, query, now_iso()))
        ffmpeg(["-ss", f"{c['hookSec'] + 0.5:.2f}", "-i", str(md / "proxy.mp4"), "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5"],
               md / "clips" / f"{cid}.jpg")  # best effort


def candidate(c: dict, sents, cue_map: dict, length_range, duration: float) -> dict | None:
    """LLM id range → sentence-snapped candidate (None if it can't fit the length range)."""
    r = snap(c["startId"], c["endId"], sents, length_range, duration, c.get("hookId"))
    if not r:
        return None
    a, b = r
    hook = sents[c["hookId"]].start if 0 <= c.get("hookId", -1) < len(sents) else a
    cues = sorted({q for x in sents if x.start >= a and x.end <= b for q in cue_map.get(x.id, [])})
    return {"startSec": a, "endSec": b, "hookSec": max(a, hook), "why": c.get("why", ""), "kind": c.get("kind", "moment"), "cues": cues, "score": len(cues)}
