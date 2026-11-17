import json

from clipforge_worker import db
from clipforge_worker.__main__ import stages_for
from clipforge_worker.runner import run_job
from clipforge_worker.stages import search as SR
from conftest import row
from test_analyze import FakeLLM, clips_of, setup


class FakeSearch(FakeLLM):
    def __init__(self, matches=((12, 18, 13),), **kw):
        super().__init__(**kw)
        self.matches = matches

    def __call__(self, task, payload, timeout=300):
        if task == "search":
            self.calls.append((task, payload))
            ids = {s["id"] for s in payload["sentences"]}
            return {"matches": [{"startId": a, "endId": b, "hookId": h, "why": "match"} for a, b, h in self.matches if a in ids]}, False
        return super().__call__(task, payload, timeout)


def add_search_job(conn, pid, query):
    import uuid
    jid = str(uuid.uuid4())
    conn.execute("INSERT INTO Job (id, projectId, type, status, stageDone, progress, payload, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
                 (jid, pid, "search", "queued", "[]", 0, json.dumps({"query": query}), db.now_iso(), db.now_iso()))
    conn.execute("UPDATE Job SET status='done' WHERE projectId=? AND type='ingest'", (pid,))
    return jid


def test_search_creates_clips_tagged_with_the_query(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    add_search_job(conn, pid, "blind dates")
    fake = FakeSearch(); monkeypatch.setattr(SR, "call_llm_ex", fake); monkeypatch.setattr("clipforge_worker.stages.analyze.call_llm_ex", fake)
    job = db.claim_next_job(conn)
    assert job.type == "search" and job.payload == {"query": "blind dates"}
    run_job(conn, job, stages_for(job))
    out = clips_of(conn, pid)
    assert len(out) == 1 and out[0]["source"] == "search" and out[0]["query"] == "blind dates"
    assert row(conn, "Project", pid)["status"] == "ready"
    assert next(p for t, p in fake.calls if t == "search")["query"] == "blind dates"


def test_search_no_match_warns_and_creates_nothing(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    add_search_job(conn, pid, "dinosaurs")
    fake = FakeSearch(matches=()); monkeypatch.setattr(SR, "call_llm_ex", fake); monkeypatch.setattr("clipforge_worker.stages.analyze.call_llm_ex", fake)
    job = db.claim_next_job(conn)
    run_job(conn, job, stages_for(job))
    assert clips_of(conn, pid) == []
    assert row(conn, "Project", pid)["warning"] == "No moment matched “dinosaurs”"
    assert row(conn, "Project", pid)["status"] == "ready"


def test_analyze_job_reruns_only_the_analysis_stages():
    job = db.Job("j", "p", "queued", None, [], 0.0, "analyze", {})
    assert list(stages_for(job)) == ["signals", "faces", "speakers", "analyzing"]
    assert list(stages_for(db.Job("j", "p", "queued", None, [], 0.0, "ingest", {})))[:2] == ["importing", "preparing"]


def test_failed_search_job_leaves_project_ready(conn, data_dir, clips, monkeypatch):
    pid = setup(conn, data_dir, clips)
    add_search_job(conn, pid, "anything")
    def boom(ctx):
        raise RuntimeError("model exploded")
    job = db.claim_next_job(conn)
    run_job(conn, job, {"searching": boom})
    assert row(conn, "Project", pid)["status"] == "ready"   # the transcript and existing clips are still fine
    assert "model exploded" in row(conn, "Project", pid)["warning"]
