"""Optional Hinglish captions: romanise Hindi words through the user's AI model, 1:1 so timestamps stay valid."""
import json

from ..llm import LlmError, LlmUnavailable, call_llm

BATCH = 300
NO_MODEL = "Hinglish skipped: set a model in Settings → AI (Titles or Highlight task)"


def run(ctx) -> None:
    path = ctx.media_dir / "transcript.json"
    t = json.loads(path.read_text())
    if ctx.settings.get("captionScript") != "hinglish" or t.get("language") != "hi" or "words_native" in t:
        ctx.report(1.0)
        return
    native = t["words"]
    out, kept, batches = [], 0, [native[i:i + BATCH] for i in range(0, len(native), BATCH)]
    for n, batch in enumerate(batches):
        try:
            res = call_llm("hinglish", {"words": [w["w"] for w in batch]})
        except LlmUnavailable:
            ctx.set_project(warning=NO_MODEL)
            ctx.report(1.0)
            return
        except LlmError:
            res = {}
        roman = res.get("words") if isinstance(res, dict) else None
        if isinstance(roman, list) and len(roman) == len(batch) and all(isinstance(r, str) and r.strip() for r in roman):
            out += [{**w, "w": r.strip()} for w, r in zip(batch, roman)]
        else:  # the model changed the word count — keep this part as-is rather than misalign timestamps
            out += batch
            kept += 1
        ctx.report((n + 1) / len(batches), "Writing Hinglish captions")
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({**t, "words": out, "words_native": native}))
    tmp.replace(path)
    if kept:
        ctx.set_project(warning=f"Hinglish applied to {len(batches) - kept} of {len(batches)} parts; the rest kept in Hindi script")
    ctx.report(1.0)
