import json
import os
import resource
import subprocess

import pytest

from clipforge_worker.errors import UserError
from clipforge_worker.stages import transcribe as T
from conftest import ctx_for, row, upload_project


def test_model_repo_map_and_override(monkeypatch):
    monkeypatch.delenv("CLIPFORGE_WHISPER_REPO", raising=False)
    assert T.model_repo("large-v3-turbo") == "mlx-community/whisper-large-v3-turbo"
    assert T.model_repo("medium") == "mlx-community/whisper-medium-mlx"
    assert T.model_repo("small") == "mlx-community/whisper-small-mlx"
    assert T.model_repo("nonsense") == "mlx-community/whisper-large-v3-turbo"
    monkeypatch.setenv("CLIPFORGE_WHISPER_REPO", "mlx-community/whisper-tiny")
    assert T.model_repo("small") == "mlx-community/whisper-tiny"


def test_build_prompt():
    assert T.build_prompt([]) is None
    assert T.build_prompt(["Sohan", "ClipForge"]) == "Glossary: Sohan, ClipForge."
    long = T.build_prompt([f"Word{i:02d}abcdefgh" for i in range(60)])
    assert len(long) <= 200 and long.endswith(".") and long.startswith("Glossary: Word00")


def test_clean_words():
    raw = [
        {"word": " Hello", "start": 0.0, "end": 0.4},
        {"word": " ", "start": 0.4, "end": 0.5},
        {"word": "world,", "start": 0.3, "end": 0.3},     # overlaps previous end, zero length
        {"word": " again", "start": 0.2, "end": 1.004},   # goes backwards
    ]
    out = T.clean_words(raw)
    assert [w["w"] for w in out] == ["Hello", "world,", "again"]
    for a, b in zip(out, out[1:]):
        assert b["s"] >= a["e"]
    assert all(w["e"] > w["s"] for w in out)
    assert out[1] == {"w": "world,", "s": 0.4, "e": 0.45}


def test_unload_runs_even_on_error(conn, data_dir, clips, monkeypatch):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    (data_dir / "media" / pid / "audio.wav").write_bytes(b"x")
    unloaded = []
    monkeypatch.setattr(T, "_backend", lambda: ("fake", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")), lambda: unloaded.append(1)))
    with pytest.raises(RuntimeError):
        T.run(ctx_for(conn))
    assert unloaded == [1]


def test_no_words_is_user_error(conn, data_dir, clips, monkeypatch):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    (data_dir / "media" / pid / "audio.wav").write_bytes(b"x")
    monkeypatch.setattr(T, "_backend", lambda: ("fake", lambda *a, **k: {"language": "en", "segments": []}, lambda: None))
    with pytest.raises(UserError, match="No speech found in this video"):
        T.run(ctx_for(conn))


def test_writes_transcript_and_language_and_passes_prompt(conn, data_dir, clips, monkeypatch):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"], settings={"vocabulary": ["Sohan"], "language": "hi"})
    (data_dir / "media" / pid / "audio.wav").write_bytes(b"x")
    seen = {}
    def fake(wav, *, repo, prompt, language, report):
        seen.update(prompt=prompt, language=language)
        report(0.5)
        return {"language": "hi", "segments": [{"words": [{"word": " namaste", "start": 0, "end": 0.5}]}]}
    monkeypatch.setattr(T, "_backend", lambda: ("fake", fake, lambda: None))
    T.run(ctx_for(conn))
    t = json.loads((data_dir / "media" / pid / "transcript.json").read_text())
    assert t["words"] == [{"w": "namaste", "s": 0.0, "e": 0.5}]
    assert t["language"] == "hi"
    assert seen == {"prompt": "Glossary: Sohan.", "language": "hi"}
    assert row(conn, "Project", pid)["language"] == "hi"


def test_existing_transcript_is_checkpoint(conn, data_dir, clips, monkeypatch):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    (data_dir / "media" / pid / "transcript.json").write_text('{"language":"en","words":[{"w":"x","s":0,"e":1}]}')
    monkeypatch.setattr(T, "_backend", lambda: pytest.fail("should not transcribe again"))
    T.run(ctx_for(conn))


@pytest.mark.slow
@pytest.mark.skipif(os.environ.get("CLIPFORGE_SLOW") != "1", reason="set CLIPFORGE_SLOW=1 (downloads whisper-tiny)")
def test_real_transcription(conn, data_dir, clips, monkeypatch, tmp_path):
    monkeypatch.setenv("CLIPFORGE_WHISPER_REPO", "mlx-community/whisper-tiny")
    pid, _ = upload_project(conn, data_dir, clips["with_audio"], settings={"language": "en"})
    aiff = tmp_path / "s.aiff"
    subprocess.run(["say", "-o", str(aiff), "Hello, this is clip forge testing transcription on a Mac."], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-ac", "1", "-ar", "16000", str(data_dir / "media" / pid / "audio.wav")], check=True)
    ctx = ctx_for(conn)
    reports = []
    real = ctx.report
    ctx.report = lambda f, message=None: (reports.append(f), real(f, message))
    T.run(ctx)
    words = json.loads((data_dir / "media" / pid / "transcript.json").read_text())["words"]
    text = " ".join(w["w"] for w in words).lower()
    assert "clip" in text and "mac" in text
    assert all(b["s"] >= a["e"] for a, b in zip(words, words[1:]))
    assert len(reports) >= 2
    print(f"\npeak RSS: {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20:.0f} MB")
