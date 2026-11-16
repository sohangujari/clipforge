import json

import pytest

from clipforge_worker import llm
from clipforge_worker.stages import analyze as A
from conftest import ctx_for, row, upload_project


def transcript(n_sent=30, words_per=8, word_s=0.4):
    words, t = [], 0.0
    for i in range(n_sent):
        for j in range(words_per):
            w = f"s{i}w{j}" + ("." if j == words_per - 1 else "")
            words.append({"w": w, "s": round(t, 2), "e": round(t + word_s - 0.05, 2)}); t += word_s
        t += 0.4
    return words  # 30 sentences × ~3.6 s ≈ 108 s


def setup(conn, data_dir, clips, settings=None, content_type="podcast", laugh_at=None):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"], settings={"lengthRange": [15, 60], **(settings or {})})
    conn.execute("UPDATE Project SET contentType=?, durationSec=? WHERE id=?", (content_type, 120, pid))
    m = data_dir / "media" / pid
    __import__("shutil").copy(clips["long_proxy"], m / "proxy.mp4")  # 120 s, like the real preview
    (m / "transcript.json").write_text(json.dumps({"language": "en", "words": transcript()}))
    n = int(120 / 0.48)
    lau = [0.001] * n
    if laugh_at is not None:
        lau[int(laugh_at / 0.48)] = 0.3
    (m / "signals.json").write_text(json.dumps({"hop": 0.48, "laughter": lau, "applause": [0.0] * n, "cheering": [0.0] * n,
                                                "scream": [0.0] * n, "gasp": [0.0] * n, "rms_db": [-30.0] * n, "pace": [2.5] * n}))
    return pid


class FakeLLM:
    """Scripted model. `highlights` returns given candidate id ranges per call; score/metadata echo keys."""
    def __init__(self, ranges=((2, 6, 2), (12, 18, 13), (22, 27, 22)), local=False, fail=None, scores=70, detect="podcast"):
        self.ranges, self.local, self.fail, self.scores, self.detect = ranges, local, fail or {}, scores, detect
        self.calls = []

    def __call__(self, task, payload, timeout=300):
        self.calls.append((task, payload))
        n = sum(1 for t, _ in self.calls if t == task)
        if (task, n) in self.fail:
            raise self.fail[(task, n)]
        if task == "info":
            return {"local": self.local, "provider": "google", "model": "m"}, self.local
        if task == "highlights":
            ids = {s["id"] for s in payload["sentences"]}
            c = [{"startId": a, "endId": b, "hookId": h, "why": f"why {a}", "kind": "story"} for a, b, h in self.ranges if a in ids]
            return {"candidates": c, **({"contentType": self.detect} if payload.get("detectType") else {})}, self.local
        if task == "score":
            return {"scores": [{"key": c["key"], "hook": self.scores, "emotion": self.scores, "value": self.scores, "pacing": self.scores,
                                "trend": self.scores, "extra": {}, "reasons": {"hook": "Opens strong"}, "summary": "ok", "tips": ["tip"]}
                               for c in payload["clips"]]}, self.local
        if task == "metadata":
            return {"items": [{"key": c["key"], "titles": [f"T {c['key']}", "B", "C"], "descriptions": {"shorts": "s", "tiktok": "t", "reels": "r"},
                               "hashtags": ["#a", "#b", "#c", "#d", "#e"]} for c in payload["clips"]]}, self.local
        if task == "unload":
            return {"unloaded": False}, False
        raise AssertionError(task)


def clips_of(conn, pid):
    conn.row_factory = __import__("sqlite3").Row
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM Clip WHERE projectId=? ORDER BY score DESC", (pid,))]
    finally:
        conn.row_factory = None


def test_clips_created_with_snapped_bounds_inside_length_range(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    fake = FakeLLM(); monkeypatch.setattr(A, "call_llm_ex", fake)
    A.run(ctx_for(conn))
    out = clips_of(conn, pid)
    assert len(out) == 3
    for c in out:
        assert 15 <= c["endSec"] - c["startSec"] <= 60.5
        assert json.loads(c["titles"])[0].startswith("T ")
        assert (data_dir / "media" / pid / "clips" / f"{c['id']}.jpg").exists()


def test_cloud_run_makes_exactly_3_model_requests(conn, data_dir, clips, monkeypatch):
    setup(conn, data_dir, clips)
    fake = FakeLLM(); monkeypatch.setattr(A, "call_llm_ex", fake)
    A.run(ctx_for(conn))
    assert [t for t, _ in fake.calls if t in ("highlights", "score", "metadata")] == ["highlights", "score", "metadata"]


def test_laughter_cue_reaches_the_prompt(conn, data_dir, clips, monkeypatch):
    setup(conn, data_dir, clips, laugh_at=4 * 3.6 + 3.0)  # just after sentence 4
    fake = FakeLLM(); monkeypatch.setattr(A, "call_llm_ex", fake)
    A.run(ctx_for(conn))
    sents = next(p for t, p in fake.calls if t == "highlights")["sentences"]
    assert "laughter" in sents[4]["cues"]


def test_bad_window_skipped_with_warning(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    fake = FakeLLM(local=True, fail={("highlights", 2): llm.LlmError("bad json"), ("highlights", 3): llm.LlmError("bad json")})  # fails its retry too
    monkeypatch.setattr(A, "call_llm_ex", fake)
    monkeypatch.setattr(A, "LOCAL_WINDOW", (60, 10))  # several windows on a small transcript
    A.run(ctx_for(conn))
    assert len(clips_of(conn, pid)) >= 1
    assert "couldn't be analysed" in row(conn, "Project", pid)["warning"]


def test_ids_out_of_range_are_ignored(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM(ranges=((2, 6, 2), (500, 600, 500))))
    A.run(ctx_for(conn))
    assert len(clips_of(conn, pid)) == 1


def test_always_at_least_3_even_when_scores_are_low(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM(scores=20))
    A.run(ctx_for(conn))
    assert len(clips_of(conn, pid)) == 3


def test_auto_keeps_only_60_plus_beyond_the_minimum(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    many = tuple((i, i + 4, i) for i in range(0, 26, 5))  # 6 candidates
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM(ranges=many, scores=50))
    A.run(ctx_for(conn))
    assert len(clips_of(conn, pid)) == 3  # all < 60 → the minimum 3


def test_no_model_gives_warning_and_no_clips(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM(fail={("highlights", 1): llm.LlmUnavailable("no_model")}))
    A.run(ctx_for(conn))
    assert clips_of(conn, pid) == []
    assert row(conn, "Project", pid)["warning"] == "Set a model in Settings → AI to find clips"


def test_kept_clips_survive_a_rerun(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM())
    A.run(ctx_for(conn))
    first = clips_of(conn, pid)
    conn.execute("UPDATE Clip SET status='kept' WHERE id=?", (first[0]["id"],))
    conn.execute("UPDATE Job SET status='queued'")
    A.run(ctx_for(conn))
    ids = {c["id"] for c in clips_of(conn, pid)}
    assert first[0]["id"] in ids


def test_auto_content_type_stored(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips, content_type="auto")
    fake = FakeLLM(detect="gaming"); monkeypatch.setattr(A, "call_llm_ex", fake)
    A.run(ctx_for(conn))
    assert row(conn, "Project", pid)["contentType"] == "gaming"
    assert next(p for t, p in fake.calls if t == "highlights")["detectType"] is True


def test_taste_examples_passed_to_prompt(conn, data_dir, clips, monkeypatch):
    import uuid
    from clipforge_worker.db import now_iso
    conn.execute("INSERT INTO ClipFeedback (id, contentType, action, summary, createdAt) VALUES (?,?,?,?,?)", (str(uuid.uuid4()), "podcast", "kept", "“Great story” — about dates", now_iso()))
    setup(conn, data_dir, clips)
    fake = FakeLLM(); monkeypatch.setattr(A, "call_llm_ex", fake)
    A.run(ctx_for(conn))
    assert next(p for t, p in fake.calls if t == "highlights")["examples"]["kept"] == ["“Great story” — about dates"]


def test_rate_limited_then_succeeds(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    fake = FakeLLM(fail={("highlights", 1): llm.RateLimited(0), ("highlights", 2): llm.RateLimited(0)})
    monkeypatch.setattr(A, "call_llm_ex", fake)
    ctx = ctx_for(conn); msgs = []
    real = ctx.report; ctx.report = lambda f, message=None: (msgs.append(message), real(f, message))
    A.run(ctx)
    assert len(clips_of(conn, pid)) == 3
    assert any(m and "Rate limited" in m for m in msgs)


def test_quota_mid_run_keeps_finished_clips_and_warns(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    fake = FakeLLM(fail={("metadata", 1): llm.QuotaExhausted("Daily free quota reached for this model — it resets at midnight Pacific.")})
    monkeypatch.setattr(A, "call_llm_ex", fake)
    A.run(ctx_for(conn))
    out = clips_of(conn, pid)
    assert len(out) == 3                       # scored clips kept, with fallback titles
    assert "Daily free quota" in row(conn, "Project", pid)["warning"]


class ManglingLLM(FakeLLM):
    """Small local models rename keys: 'hook', 'clip_0', ... Results must still land on the right clips."""
    def __call__(self, task, payload, timeout=300):
        out, local = super().__call__(task, payload, timeout)
        if task == "score":
            for i, s in enumerate(out["scores"]):
                s["key"] = "hook" if i == 0 else f"clip_{s['key']}"
                s["hook"] = 90 - i  # distinguishable
        if task == "metadata":
            for it in out["items"]:
                it["key"] = f"clip_{it['key']}"
        return out, local


def test_mangled_keys_still_match_by_number_or_position(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", ManglingLLM())
    A.run(ctx_for(conn))
    out = clips_of(conn, pid)
    assert len(out) == 3
    assert all(json.loads(c["titles"])[0].startswith("T ") for c in out)        # real titles, not the fallback "why"
    assert all(json.loads(c["breakdown"])["hook"] >= 88 for c in out)           # real scores, not neutral 50s


def test_timeout_mid_run_skips_that_part_and_keeps_earlier_clips(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    fake = FakeLLM(local=True, fail={("highlights", 3): llm.LlmTimeout("timed out"), ("highlights", 4): llm.LlmTimeout("timed out")})
    monkeypatch.setattr(A, "call_llm_ex", fake)
    monkeypatch.setattr(A, "LOCAL_WINDOW", (60, 10))
    A.run(ctx_for(conn))
    assert len(clips_of(conn, pid)) >= 1
    w = row(conn, "Project", pid)["warning"]
    assert "Set a model" not in w and "couldn't be analysed" in w


def test_local_models_score_at_most_6_candidates_with_brief_reasons(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    many = tuple((i, i + 1, i) for i in range(0, 28, 3))  # 10 non-overlapping candidates
    fake = FakeLLM(ranges=many, local=True)
    monkeypatch.setattr(A, "call_llm_ex", fake)
    monkeypatch.setattr(A, "LOCAL_WINDOW", (10_000, 0))  # one window, so all 10 come back at once
    A.run(ctx_for(conn))
    scored = [c for t, p in fake.calls if t == "score" for c in p["clips"]]
    assert len(scored) <= 6
    assert all(p.get("brief") is True for t, p in fake.calls if t == "score")


def test_cloud_models_score_everything_in_full(conn, data_dir, clips, monkeypatch):
    setup(conn, data_dir, clips)
    many = tuple((i, i + 1, i) for i in range(0, 28, 3))
    fake = FakeLLM(ranges=many, local=False)
    monkeypatch.setattr(A, "call_llm_ex", fake)
    A.run(ctx_for(conn))
    assert len([c for t, p in fake.calls if t == "score" for c in p["clips"]]) > 6  # no local cap (overlaps are merged first)
    assert all(not p.get("brief") for t, p in fake.calls if t == "score")


def test_one_transient_failure_is_retried(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM(fail={("highlights", 1): llm.LlmError("503 overloaded")}))
    A.run(ctx_for(conn))
    assert len(clips_of(conn, pid)) == 3
    assert row(conn, "Project", pid)["warning"] is None


def test_failed_rerun_keeps_the_previous_clips(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM())
    A.run(ctx_for(conn))
    before = {c["id"] for c in clips_of(conn, pid)}
    conn.execute("UPDATE Job SET status='queued'")
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM(fail={("highlights", 1): llm.LlmError("x"), ("highlights", 2): llm.LlmError("x")}))
    A.run(ctx_for(conn))
    assert {c["id"] for c in clips_of(conn, pid)} == before
    assert "kept your previous clips" in row(conn, "Project", pid)["warning"]


def test_provider_busy_waits_with_a_clear_message_then_succeeds(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    fake = FakeLLM(fail={("highlights", 1): llm.RateLimited(0, busy=True)})
    monkeypatch.setattr(A, "call_llm_ex", fake)
    ctx = ctx_for(conn); msgs = []
    real = ctx.report; ctx.report = lambda f, message=None: (msgs.append(message), real(f, message))
    A.run(ctx)
    assert len(clips_of(conn, pid)) == 3
    assert any(m and "is busy" in m for m in msgs)
