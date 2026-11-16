"""Word-level transcription. mlx-whisper (Metal GPU) on Apple Silicon, faster-whisper on CPU elsewhere.
On 8 GB unified memory the model is always unloaded afterwards — it shares RAM with everything else."""
import gc
import json
import os
import platform
import sys
import threading

from ..errors import UserError

REPOS = {
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    "medium": "mlx-community/whisper-medium-mlx",
    "small": "mlx-community/whisper-small-mlx",
}
FASTER_SIZES = {"large-v3-turbo": "large-v3-turbo", "medium": "medium", "small": "small"}
PROMPT_MAX = 200
MIN_WORD_S = 0.05
IS_APPLE_SILICON = sys.platform == "darwin" and platform.machine() == "arm64"


def model_repo(setting: str) -> str:
    return os.environ.get("CLIPFORGE_WHISPER_REPO") or REPOS.get(setting, REPOS["large-v3-turbo"])


def build_prompt(vocabulary: list[str]) -> str | None:
    """Whisper spells names it has 'seen' in the prompt, so custom words go in as a glossary."""
    words = [w.strip() for w in vocabulary if w.strip()]
    if not words:
        return None
    out = "Glossary: " + words[0]
    for w in words[1:]:
        if len(out) + len(w) + 3 > PROMPT_MAX:
            break
        out += ", " + w
    return out + "."


def clean_words(raw: list[dict]) -> list[dict]:
    """Strip text, drop empties, and make timings strictly forward-moving with a minimum length."""
    out, prev_e = [], 0.0
    for r in raw:
        w = (r.get("word") or "").strip()
        if not w:
            continue
        s = max(float(r.get("start") or 0), prev_e)
        e = max(float(r.get("end") or 0), s + MIN_WORD_S)
        s, e = round(s, 2), round(e, 2)
        out.append({"w": w, "s": s, "e": e})
        prev_e = e
    return out


def _mlx_transcribe(wav, *, repo, prompt, language, report):
    import importlib

    import mlx_whisper
    mt = importlib.import_module("mlx_whisper.transcribe")  # the package re-exports a *function* named transcribe

    orig = mt.tqdm.tqdm

    class Progress(orig):  # mlx-whisper's only progress signal is its tqdm bar
        def __init__(self, *a, **kw):
            kw["file"] = open(os.devnull, "w")
            super().__init__(*a, **kw)

        def update(self, n=1):
            super().update(n)
            if self.total:
                report(self.n / self.total)  # may raise Cancelled → aborts transcription

    mt.tqdm.tqdm = Progress
    try:
        return mlx_whisper.transcribe(str(wav), path_or_hf_repo=repo, word_timestamps=True, initial_prompt=prompt,
                                      language=language, verbose=False, condition_on_previous_text=False)
    finally:
        mt.tqdm.tqdm = orig


def _mlx_unload():
    import mlx.core as mx
    from mlx_whisper.transcribe import ModelHolder
    ModelHolder.model = None
    ModelHolder.model_path = None
    gc.collect()
    mx.clear_cache()


def _faster_transcribe(wav, *, repo, prompt, language, report):
    from faster_whisper import WhisperModel
    size = next((k for k, v in REPOS.items() if v == repo), "small")
    model = WhisperModel(FASTER_SIZES.get(size, "small"), device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(wav), word_timestamps=True, vad_filter=True, initial_prompt=prompt, language=language)
    out = []
    for seg in segments:
        out.append({"words": [{"word": w.word, "start": w.start, "end": w.end} for w in seg.words or []]})
        if info.duration:
            report(seg.end / info.duration)
    return {"language": info.language, "segments": out}


def _backend():
    if IS_APPLE_SILICON:
        return "mlx", _mlx_transcribe, _mlx_unload
    return "faster-whisper", _faster_transcribe, gc.collect


WEIGHTS = ("weights.safetensors", "weights.npz", "model.safetensors")


def _cached_file(repo: str, name: str) -> bool:
    from huggingface_hub import try_to_load_from_cache
    return isinstance(try_to_load_from_cache(repo, name), str)


def model_cached(repo: str, weights: tuple[str, ...] = WEIGHTS) -> bool:
    """Downloaded = the weights file is there. config.json alone means an earlier download broke halfway."""
    try:
        return any(_cached_file(repo, w) for w in weights)
    except Exception:  # noqa: BLE001
        return False


def _cache_dir(repo: str):
    from pathlib import Path
    from huggingface_hub import constants
    return Path(constants.HF_HUB_CACHE) / f"models--{repo.replace('/', '--')}"


def _repo_size(repo: str) -> int:
    from huggingface_hub import HfApi
    return sum(s.size or 0 for s in HfApi().model_info(repo, files_metadata=True).siblings)


def _snapshot(repo: str) -> None:
    from huggingface_hub import snapshot_download
    snapshot_download(repo)  # resumes .incomplete files from an interrupted download


def _sizes(path) -> dict:
    return {f: f.stat().st_size for f in path.rglob("*") if f.is_file() and not f.is_symlink()} if path.exists() else {}


def _downloaded(path, before: dict) -> int:
    """Size of the file actually being downloaded. Leftover partial files from broken earlier attempts
    don't change, so they're ignored; a resumed file counts in full (those bytes are real progress)."""
    active = [size for f, size in _sizes(path).items() if before.get(f) != size]
    return max(active, default=0)


def ensure_model(repo: str, report, poll_s: float = 1.0, weights: tuple[str, ...] = WEIGHTS, label: str = "speech model") -> None:
    """Download a model once, reporting real MB progress. Later runs load it from disk."""
    cached = model_cached(repo) if weights == WEIGHTS else model_cached(repo, weights)
    if cached:
        return
    try:
        total = _repo_size(repo)
    except Exception:  # noqa: BLE001 — offline: let the download attempt produce the error
        total = 0
    err: list[BaseException] = []
    t = threading.Thread(target=lambda: _run_capture(lambda: _snapshot(repo), err), daemon=True, name="model-download")
    cache = _cache_dir(repo)
    before = _sizes(cache)
    t.start()
    while t.is_alive():
        got = min(_downloaded(cache, before), total) if total else 0
        frac = min(got / total, 0.99) if total else 0.0
        report(frac, f"Downloading {label} (one-time) · {got / 1e6:.0f} MB of {total / 1e6:.0f} MB" if total
               else f"Downloading {label} (one-time)")  # may raise Cancelled; the download resumes next time
        t.join(poll_s)
    if err:
        raise UserError(f"Couldn't download the {label} — check your internet connection, then Retry (it resumes where it stopped)") from err[0]
    report(1.0)


def _run_capture(fn, err: list) -> None:
    try:
        fn()
    except BaseException as e:  # noqa: BLE001
        err.append(e)


def run(ctx) -> None:
    out = ctx.media_dir / "transcript.json"
    if out.exists() and out.stat().st_size > 0:
        ctx.report(1.0)
        return
    wav = ctx.media_dir / "audio.wav"
    s = ctx.settings
    repo = model_repo(s.get("whisperModel") or "large-v3-turbo")
    language = None if s.get("language", "auto") == "auto" else s["language"]
    name, transcribe, unload = _backend()
    base = 0.0
    if name == "mlx" and not model_cached(repo):
        ensure_model(repo, lambda f, msg=None: ctx.report(f * 0.5, msg))  # first half of the stage bar
        base = 0.5
    try:
        result = transcribe(wav, repo=repo, prompt=build_prompt(s.get("vocabulary") or []), language=language,
                            report=lambda f: ctx.report(base + f * (1 - base), "Transcribing"))
    finally:
        unload()
    words = clean_words([w for seg in result.get("segments", []) for w in seg.get("words") or []])
    if not words:
        raise UserError("No speech found in this video")
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps({"language": result.get("language"), "words": words, "model": repo}))
    tmp.replace(out)
    ctx.set_project(language=result.get("language"))
    ctx.report(1.0)
