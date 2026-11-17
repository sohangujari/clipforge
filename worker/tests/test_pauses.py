import json

import numpy as np

from clipforge_worker import pauses


def _speech(sec, sr=16000, amp=0.3):
    return (amp * np.sin(np.arange(int(sec * sr)) * 0.2)).astype(np.float32)


def test_finds_the_pause_between_speech_relative_to_the_recording_level():
    hiss = lambda s: (0.002 * np.random.default_rng(0).standard_normal(int(s * 16000))).astype(np.float32)  # noqa: E731
    x = np.concatenate([_speech(2), hiss(0.8), _speech(1), hiss(0.1), _speech(1)])
    got = pauses.find(x)
    assert len(got) == 1  # the 0.1 s gap is speech rhythm
    assert abs(got[0][0] - 2.0) < 0.03 and abs(got[0][1] - 2.8) < 0.03
    quiet = np.concatenate([_speech(2, amp=0.01), np.zeros(8000, np.float32), _speech(1, amp=0.01)])
    assert len(pauses.find(quiet)) == 1  # a quiet recording still has its pause found


def test_ensure_writes_once(tmp_path):
    import wave
    x = np.concatenate([_speech(1), np.zeros(16000, np.float32), _speech(1)])
    with wave.open(str(tmp_path / "audio.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
    pauses.ensure(tmp_path)
    assert json.loads((tmp_path / "silences.json").read_text())["silences"] == [[1.0, 2.0]]
