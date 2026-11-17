"""Real pauses in the audio (Whisper's word times stretch over pauses, so they can't be trusted for this).
Writes media/<id>/silences.json once per video; the editor turns the long ones into cuts (web/lib/cuts.ts)."""
import json
from pathlib import Path

import numpy as np

FRAME_S = 0.02
MIN_S = 0.3     # the editor only cuts pauses ≥ 0.5 s; shorter runs are kept for later tuning
BELOW_DB = 30   # quieter than the video's loud speech by this much = a pause (relative: levels differ per recording)
FLOOR_DB = -60


def find(x: np.ndarray, sr: int = 16000) -> list[list[float]]:
    n = int(FRAME_S * sr)
    frames = x[: len(x) // n * n].reshape(-1, n)
    if not len(frames):
        return []
    db = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    quiet = db < max(float(np.percentile(db, 95)) - BELOW_DB, FLOOR_DB)
    out, start = [], None
    for i, q in enumerate([*quiet, False]):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if (i - start) * FRAME_S >= MIN_S:
                out.append([round(start * FRAME_S, 3), round(i * FRAME_S, 3)])
            start = None
    return out


def ensure(media_dir: Path) -> None:
    out = media_dir / "silences.json"
    if out.exists() or not (media_dir / "audio.wav").exists():
        return
    from .signals import _read_wav
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps({"silences": find(_read_wav(media_dir / "audio.wav"))}))
    tmp.replace(out)
