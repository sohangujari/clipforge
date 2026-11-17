"""Audio signals for clip finding: reactions (YAMNet: laughter, applause, cheering, screams, gasps), loudness and
speech pace, one value per 0.48 s frame. Scores are compared within each video (robust z-scores) — laughter under
speech is quiet in absolute terms, so fixed thresholds don't work."""
import csv
import gc
import json
import wave
from pathlib import Path

import numpy as np

YAMNET_REPO = "andrelgomes/yamnet-onnx"
YAMNET_FILE = "yamnet.onnx"
HOP = 0.48                     # YAMNet frame hop (window 0.96 s)
SR = 16000
CHUNK_S = 60                   # 1-minute chunks: 10-minute chunks peaked at ~1.4 GB RAM on a real video
CLASSES = {
    "laughter": ["Laughter", "Giggle", "Belly laugh", "Chuckle, chortle"],
    "applause": ["Applause", "Clapping"],
    "cheering": ["Cheering", "Crowd"],
    "scream": ["Screaming", "Shout", "Yell"],
    "gasp": ["Gasp"],
}
REACTION_TRAIL_S = 2.0         # laughs and applause land just after the line
# Floor for the spread in robust_z: most frames score ~0 for reactions, so the measured spread can be 0 and
# every speck of noise would look enormous. Units: class probability, dB, words/s.
MIN_SCALE = {"laughter": 0.01, "applause": 0.01, "cheering": 0.01, "scream": 0.01, "gasp": 0.01, "rms_db": 3.0, "pace": 0.5}


def _class_indices() -> dict[str, list[int]]:
    rows = list(csv.reader(open(Path(__file__).parent / "assets" / "yamnet_class_map.csv")))[1:]
    names = {r[2]: int(r[0]) for r in rows}
    return {k: [names[n] for n in v if n in names] for k, v in CLASSES.items()}


def _session(report):
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from .stages.transcribe import ensure_model
    ensure_model(YAMNET_REPO, lambda f, msg=None: report(f * 0.3, msg), weights=(YAMNET_FILE,), label="reaction detector")
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2  # leave cores for the UI
    return ort.InferenceSession(hf_hub_download(YAMNET_REPO, YAMNET_FILE), opts, providers=["CPUExecutionProvider"])


def _read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def robust_z(x, min_scale: float = 1e-6) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    if x.size == 0:
        return x
    med = np.median(x)
    mad = np.median(np.abs(x - med))
    return (x - med) / max(1.4826 * mad, min_scale)


def segment_features(sig: dict, start: float, end: float) -> dict:
    """Max robust z inside [start, end + 2 s] for each signal; energy = loudness, pace = words/s."""
    hop = sig["hop"]
    a, b = int(start / hop), int((end + REACTION_TRAIL_S) / hop) + 1
    out = {}
    for k, src in (("laughter", "laughter"), ("applause", "applause"), ("cheering", "cheering"),
                   ("scream", "scream"), ("energy", "rms_db"), ("pace", "pace")):
        z = robust_z(sig.get(src, []), MIN_SCALE.get(src, 1e-6))
        seg = z[a:b]
        out[k] = round(float(seg.max()), 2) if seg.size else 0.0
    return out


def peaks(sig: dict, kind: str, z_min: float = 3.0, min_gap_s: float = 8.0) -> list[tuple[float, float]]:
    z = robust_z(sig.get(kind, []), MIN_SCALE.get(kind, 1e-6))
    hop = sig["hop"]
    cand = sorted(((float(z[i]), i) for i in range(len(z)) if z[i] >= z_min), reverse=True)
    picked: list[int] = []
    for _, i in cand:
        if all(abs(i - j) * hop >= min_gap_s for j in picked):
            picked.append(i)
    return sorted((round(i * hop, 2), round(float(z[i]), 2)) for i in picked)


def _frames(session, x: np.ndarray, report) -> np.ndarray:
    chunk, overlap = CHUNK_S * SR, SR
    parts, start = [], 0
    while start < len(x):
        seg = x[max(0, start - overlap): start + chunk]
        scores = session.run(None, {"waveform": seg})[0]
        if start > 0:
            scores = scores[int(1 / HOP):]  # drop the frames that came from the overlap second
        parts.append(scores)
        start += chunk
        report(0.3 + 0.6 * min(1.0, start / len(x)))
    return np.concatenate(parts) if parts else np.zeros((0, 521), np.float32)


def run(ctx) -> None:
    from . import pauses
    pauses.ensure(ctx.media_dir)  # cheap; also fills in projects from before Phase 4b on "Find clips again"
    out = ctx.media_dir / "signals.json"
    if out.exists() and out.stat().st_size > 0:
        ctx.report(1.0)
        return
    x = _read_wav(ctx.media_dir / "audio.wav")
    report = lambda f, msg=None: ctx.report(f, msg or "Listening for reactions")  # noqa: E731
    session = _session(report)
    try:
        scores = _frames(session, x, report)
    finally:
        del session
        gc.collect()
    n = len(scores)
    idx = _class_indices()
    sig: dict = {"hop": HOP}
    for k, cols in idx.items():
        sig[k] = [round(float(v), 4) for v in scores[:, cols].max(axis=1)] if cols and n else [0.0] * n
    win = int(0.96 * SR)
    rms = []
    for i in range(n):
        frame = x[int(i * HOP * SR): int(i * HOP * SR) + win]
        rms.append(round(float(20 * np.log10(np.sqrt(np.mean(frame ** 2)) + 1e-9)), 2) if frame.size else -120.0)
    sig["rms_db"] = rms
    words = json.loads((ctx.media_dir / "transcript.json").read_text()).get("words", [])
    starts = np.array([w["s"] for w in words]) if words else np.zeros(0)
    sig["pace"] = [round(float(((starts >= i * HOP - 1.5) & (starts < i * HOP + 1.5)).sum() / 3.0), 2) for i in range(n)]
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(sig))
    tmp.replace(out)
    ctx.report(1.0)
