"""Phase 3 final-review fixes: lost clips on quota, reappearing clips, honest search failures, local context size."""
import json
import uuid

from clipforge_worker import db, llm
from clipforge_worker.__main__ import stages_for
from clipforge_worker.clips.boundaries import dedupe
from clipforge_worker.clips.sentences import Sentence
from clipforge_worker.clips.windows import windows
from clipforge_worker.runner import run_job
from clipforge_worker.stages import analyze as A
from clipforge_worker.stages import search as SR
from conftest import ctx_for, row
from test_analyze import FakeLLM, clips_of, setup
from test_search import FakeSearch, add_search_job


def rerun(conn):
    conn.execute("UPDATE Job SET status='queued'")
    A.run(ctx_for(conn))


def test_quota_on_the_first_request_keeps_the_previous_clips(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM())
    A.run(ctx_for(conn))
    before = {c["id"] for c in clips_of(conn, pid)}
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM(fail={("highlights", 1): llm.QuotaExhausted("Daily free quota reached")}))
    rerun(conn)
    assert {c["id"] for c in clips_of(conn, pid)} == before
    assert "Daily free quota" in row(conn, "Project", pid)["warning"]


def test_kept_and_deleted_moments_are_not_found_again(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    monkeypatch.setattr(A, "call_llm_ex", FakeLLM())
    A.run(ctx_for(conn))
    a, b, _ = clips_of(conn, pid)
    conn.execute("UPDATE Clip SET status='kept' WHERE id=?", (a["id"],))
    conn.execute("UPDATE Clip SET status='deleted' WHERE id=?", (b["id"],))
    rerun(conn)
    out = clips_of(conn, pid)
    new = [c for c in out if c["status"] == "new"]
    assert len(new) == 1                                   # only the third moment; kept one isn't duplicated, deleted one stays gone
    for old in (a, b):
        assert all(c["endSec"] <= old["startSec"] or c["startSec"] >= old["endSec"] for c in new)


def test_mostly_overlapping_clips_collapse_even_with_low_iou():
    # seen with qwen3.5:2b: 6:33–7:05 and 6:45–7:17 share 20 of 32 s (IoU 0.45) — the same moment
    out = dedupe([{"startSec": 393, "endSec": 425, "score": 68}, {"startSec": 405, "endSec": 437, "score": 70}])
    assert [c["score"] for c in out] == [70]


def test_search_that_failed_says_so_instead_of_no_match(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    add_search_job(conn, pid, "blind dates")

    class Broken(FakeSearch):
        def __call__(self, task, payload, timeout=300):
            if task == "search":
                raise llm.LlmError("provider error")
            return super().__call__(task, payload, timeout)
    fake = Broken(); monkeypatch.setattr(SR, "call_llm_ex", fake); monkeypatch.setattr(A, "call_llm_ex", fake)
    job = db.claim_next_job(conn)
    run_job(conn, job, stages_for(job))
    w = row(conn, "Project", pid)["warning"]
    assert "No moment matched" not in w and "couldn't finish" in w


def test_non_latin_text_makes_smaller_windows():
    def sents(text, n=150):
        k = len(text.split())
        return [Sentence(i, i * 3.0, i * 3.0 + 2.5, text, i * k, i * k + k - 1) for i in range(n)]
    latin = windows(sents("we went to the market and bought some food"), 900, 100)
    hindi = windows(sents("हम बाज़ार गए और कुछ खाना ख़रीदा बहुत अच्छा"), 900, 100)
    assert len(hindi) > len(latin)


def test_local_models_get_a_small_taste_sample(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    for i in range(8):
        conn.execute("INSERT INTO ClipFeedback (id, contentType, action, summary, createdAt) VALUES (?,?,?,?,?)",
                     (str(uuid.uuid4()), "podcast", "kept", f"“T{i}” — " + "x" * 500, db.now_iso()))
    fake = FakeLLM(local=True); monkeypatch.setattr(A, "call_llm_ex", fake)
    A.run(ctx_for(conn))
    ex = next(p for t, p in fake.calls if t == "highlights")["examples"]
    assert len(ex["kept"]) <= 2 and all(len(s) <= 200 for s in ex["kept"])
    assert pid
    assert json.dumps(ex)
