import json

import pytest

from clipforge_worker import llm
from clipforge_worker.stages import romanize
from conftest import ctx_for, row, upload_project


def setup(conn, data_dir, clips, n_words=3, language="hi", script="hinglish"):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"], settings={"captionScript": script})
    words = [{"w": f"शब्द{i}", "s": i * 0.5, "e": i * 0.5 + 0.4} for i in range(n_words)]
    (data_dir / "media" / pid / "transcript.json").write_text(json.dumps({"language": language, "words": words}))
    return pid, words


def read(data_dir, pid):
    return json.loads((data_dir / "media" / pid / "transcript.json").read_text())


@pytest.mark.parametrize("language,script", [("en", "hinglish"), ("hi", "native")])
def test_skips_when_not_hindi_or_not_requested(conn, data_dir, clips, monkeypatch, language, script):
    pid, words = setup(conn, data_dir, clips, language=language, script=script)
    monkeypatch.setattr(romanize, "call_llm", lambda *a, **k: pytest.fail("should not call the model"))
    romanize.run(ctx_for(conn))
    assert read(data_dir, pid)["words"] == words


def test_no_model_warning(conn, data_dir, clips, monkeypatch):
    pid, words = setup(conn, data_dir, clips)
    def unavailable(*a, **k):
        raise llm.LlmUnavailable("no_model")
    monkeypatch.setattr(romanize, "call_llm", unavailable)
    romanize.run(ctx_for(conn))
    assert row(conn, "Project", pid)["warning"] == "Hinglish skipped: set a model in Settings → AI (Titles or Highlight task)"
    assert read(data_dir, pid)["words"] == words


def test_length_mismatch_keeps_original_batch(conn, data_dir, clips, monkeypatch):
    pid, words = setup(conn, data_dir, clips, n_words=650)
    calls = []
    def fake(task, payload, **k):
        calls.append(len(payload["words"]))
        ws = [f"roman{i}" for i in range(len(payload["words"]))]
        return {"words": ws[:-1] if len(calls) == 2 else ws}
    monkeypatch.setattr(romanize, "call_llm", fake)
    romanize.run(ctx_for(conn))
    out = read(data_dir, pid)
    assert calls == [300, 300, 50]
    assert out["words"][0]["w"] == "roman0"
    assert out["words"][300]["w"] == "शब्द300"      # batch 2 kept
    assert out["words"][600]["w"] == "roman0"
    assert out["words_native"][0]["w"] == "शब्द0"
    assert row(conn, "Project", pid)["warning"] == "Hinglish applied to 2 of 3 parts; the rest kept in Hindi script"


def test_timestamps_preserved(conn, data_dir, clips, monkeypatch):
    pid, words = setup(conn, data_dir, clips)
    monkeypatch.setattr(romanize, "call_llm", lambda task, p, **k: {"words": ["main", "theek", "hoon"]})
    romanize.run(ctx_for(conn))
    out = read(data_dir, pid)["words"]
    assert [w["w"] for w in out] == ["main", "theek", "hoon"]
    assert [(w["s"], w["e"]) for w in out] == [(w["s"], w["e"]) for w in words]


def test_call_llm_maps_errors(monkeypatch, data_dir):
    (data_dir / ".worker-token").write_text("t")
    monkeypatch.setenv("CLIPFORGE_WEB_PORT", "9")  # nothing listens there
    with pytest.raises(llm.LlmUnavailable):
        llm.call_llm("hinglish", {"words": ["x"]}, timeout=2)
