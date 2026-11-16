"""Plain-language search: "find where they talk about pricing" → up to 3 new clips tagged with the query."""
import json

from ..clips.boundaries import dedupe
from ..clips.sentences import split_sentences
from ..clips.windows import windows
from ..llm import LlmError, LlmUnavailable, call_llm_ex
from .analyze import CLOUD_BATCH, CLOUD_WINDOW, LOCAL_BATCH, LOCAL_WINDOW, NO_MODEL, Llm, _cues, _fmt, candidate, insert_clips, score_candidates, write_metadata


def run(ctx) -> None:
    query = (ctx.job.payload or {}).get("query", "").strip()
    md = ctx.media_dir
    words = json.loads((md / "transcript.json").read_text())["words"]
    sents = split_sentences(words)
    sig = json.loads((md / "signals.json").read_text()) if (md / "signals.json").exists() else {}
    length_range = tuple(ctx.settings.get("lengthRange") or (30, 90))
    duration = float(ctx.project.get("durationSec") or (words[-1]["e"] if words else 0))
    ctype = ctx.project.get("contentType") or "custom"
    try:
        local = bool(call_llm_ex("info", {})[0].get("local"))
    except LlmUnavailable:
        local = True
    llm = Llm(ctx)
    cue_map = _cues(sents, sig) if sig.get("hop") else {}
    cands, skipped = [], 0
    wins = windows(sents, *(LOCAL_WINDOW if local else CLOUD_WINDOW))
    for i, win in enumerate(wins):
        llm.frac = 0.6 * i / len(wins)
        ctx.report(llm.frac, f"Searching for “{query}”")
        try:
            out = llm("search", {"query": query, "lengthRange": list(length_range),
                                 "sentences": [{"id": x.id, "t": _fmt(x.start), "text": x.text, "cues": cue_map.get(x.id, [])} for x in win.sentences]})
        except LlmUnavailable as e:
            if "no_model" in str(e) and not cands:
                ctx.set_project(warning=NO_MODEL); ctx.report(1.0); return
            skipped += 1; continue
        except LlmError:
            skipped += 1; continue  # timeout / bad output: skip this part
        if out is None:
            break
        ids = {x.id for x in win.sentences}
        for m in out.get("matches", []):
            if m["startId"] in ids and m["endId"] in ids:
                c = candidate(m, sents, cue_map, length_range, duration)
                if c:
                    cands.append(c)
    chosen = dedupe(cands)[:3]
    if not chosen:
        failed = f"Search couldn't finish ({skipped} of {len(wins)} parts failed) — try again" if skipped else None
        ctx.set_project(warning=llm.quota_msg or failed or f"No moment matched “{query}”")
        ctx.report(1.0)
        return
    batch = LOCAL_BATCH if local else CLOUD_BATCH
    score_candidates(ctx, llm, chosen, words, sig, ctype, batch, brief=local)
    write_metadata(ctx, llm, chosen, words, ctype, batch)
    insert_clips(ctx, chosen, "search", query)
    ctx.set_project(warning=llm.quota_msg)
    ctx.report(1.0)
