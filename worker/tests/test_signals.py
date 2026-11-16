import json
import os
import subprocess

import numpy as np
import pytest

from clipforge_worker import signals as SIG
from conftest import ctx_for, upload_project


def test_robust_z_flags_a_spike():
    x = np.full(200, 0.02); x[120] = 0.3
    z = SIG.robust_z(x)
    assert z[120] > 10 and abs(z[5]) < 1


def test_segment_features_include_trailing_reaction():
    hop = 0.5
    lau = [0.01] * 100; lau[42] = 0.4  # laughter at 21 s, the line ends at 20 s
    s = {"hop": hop, "laughter": lau, "applause": [0.01] * 100, "cheering": [0.01] * 100, "scream": [0.01] * 100,
         "gasp": [0.01] * 100, "rms_db": [-30.0] * 100, "pace": [2.5] * 100}
    f = SIG.segment_features(s, 10.0, 20.0)
    assert f["laughter"] > 5
    assert SIG.segment_features(s, 0.0, 15.0)["laughter"] < 1


def test_peaks_respect_min_gap():
    hop = 0.5
    lau = [0.01] * 200; lau[40] = 0.5; lau[44] = 0.4; lau[150] = 0.45
    s = {"hop": hop, "laughter": lau}
    p = SIG.peaks(s, "laughter", z_min=3, min_gap_s=8)
    assert [round(t) for t, _ in p] == [20, 75]


class FakeSession:
    """Returns fixed class scores: frames = seconds / 0.48."""
    def __init__(self, laugh_at=None):
        self.laugh_at = laugh_at

    def run(self, _outs, feeds):
        x = feeds["waveform"]
        n = max(1, int(len(x) / 16000 / SIG.HOP))
        scores = np.full((n, 521), 0.01, dtype=np.float32)
        scores[:, 0] = 0.9  # speech
        return [scores, None, None]


def test_run_writes_aligned_signals(conn, data_dir, clips, monkeypatch):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    m = data_dir / "media" / pid
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(clips["with_audio"]), "-ac", "1", "-ar", "16000", str(m / "audio.wav")], check=True)
    (m / "transcript.json").write_text(json.dumps({"language": "en", "words": [{"w": "hi", "s": 1.0, "e": 1.3}, {"w": "there.", "s": 1.4, "e": 1.8}]}))
    monkeypatch.setattr(SIG, "_session", lambda report: FakeSession())
    SIG.run(ctx_for(conn))
    s = json.loads((m / "signals.json").read_text())
    n = len(s["laughter"])
    assert n > 5
    for k in ("applause", "cheering", "scream", "gasp", "rms_db", "pace"):
        assert len(s[k]) == n, k
    assert s["hop"] == SIG.HOP
    assert max(s["pace"]) > 0


def test_existing_signals_are_a_checkpoint(conn, data_dir, clips, monkeypatch):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    (data_dir / "media" / pid / "signals.json").write_text('{"hop":0.48,"laughter":[]}')
    monkeypatch.setattr(SIG, "_session", lambda report: pytest.fail("should not run the model again"))
    SIG.run(ctx_for(conn))


@pytest.mark.slow
@pytest.mark.skipif(os.environ.get("CLIPFORGE_SLOW") != "1", reason="set CLIPFORGE_SLOW=1 (downloads YAMNet, ~15 MB)")
def test_real_yamnet_hears_speech_not_laughter(conn, data_dir, tmp_path):
    aiff = tmp_path / "s.aiff"
    subprocess.run(["say", "-o", str(aiff), "This is a calm sentence about clip forge, spoken by a computer voice."], check=True)
    pid, _ = upload_project(conn, data_dir, aiff)
    m = data_dir / "media" / pid
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-ac", "1", "-ar", "16000", str(m / "audio.wav")], check=True)
    (m / "transcript.json").write_text('{"language":"en","words":[]}')
    SIG.run(ctx_for(conn))
    s = json.loads((m / "signals.json").read_text())
    assert max(s["laughter"]) < 0.2


def test_mostly_zero_signal_does_not_explode():
    x = np.zeros(1500); x[::50] = 0.001; x[700] = 0.15  # real laughter scores: almost all ~0
    z = SIG.robust_z(x, min_scale=SIG.MIN_SCALE["laughter"])
    assert z[50] < 1           # noise stays noise
    assert 5 < z[700] < 50     # a real laugh stands out, but sanely


def test_memory_stays_low_on_long_audio(monkeypatch):
    seen = []
    class S:
        def run(self, _o, feeds):
            seen.append(len(feeds["waveform"]))
            return [np.zeros((max(1, int(len(feeds["waveform"]) / 16000 / SIG.HOP)), 521), np.float32), None, None]
    SIG._frames(S(), np.zeros(16000 * 600, np.float32), lambda f: None)
    assert max(seen) <= (SIG.CHUNK_S + 1) * 16000   # never feed more than ~a minute at once
    assert SIG.CHUNK_S <= 60
