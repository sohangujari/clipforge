from clipforge_worker import db
from clipforge_worker.errors import UserError
from clipforge_worker.runner import run_job
from conftest import add_project, row


def test_claim_is_atomic_and_fifo(conn, ago):
    _, old = add_project(conn, created=ago(minutes=5))
    _, new = add_project(conn, created=ago(minutes=1))
    assert db.claim_next_job(conn).id == old
    assert db.claim_next_job(conn).id == new
    assert db.claim_next_job(conn) is None
    assert row(conn, "Job", old)["status"] == "running"


def test_stale_running_job_is_requeued(conn, ago):
    _, stale = add_project(conn, job_status="running", heartbeat=ago(minutes=10))
    _, fresh = add_project(conn, job_status="running", heartbeat=ago(seconds=5))
    assert db.requeue_stale(conn, older_than_s=120) == 1
    assert row(conn, "Job", stale)["status"] == "queued"
    assert row(conn, "Job", fresh)["status"] == "running"


def stage(name, calls, fn=None):
    def run(ctx):
        calls.append(name)
        if fn:
            fn(ctx)
        ctx.report(1.0)
    return run


def test_runs_stages_in_order_and_finishes(conn):
    pid, jid = add_project(conn)
    calls = []
    run_job(conn, db.claim_next_job(conn), {s: stage(s, calls) for s in ["a", "b"]})
    assert calls == ["a", "b"]
    assert row(conn, "Job", jid)["status"] == "done"
    assert row(conn, "Job", jid)["progress"] == 1.0
    assert row(conn, "Project", pid)["status"] == "ready"


def test_resume_skips_done_stages(conn):
    _, jid = add_project(conn, stage_done=["a"])
    calls = []
    run_job(conn, db.claim_next_job(conn), {s: stage(s, calls) for s in ["a", "b"]})
    assert calls == ["b"]


def test_cancel_requested_stops_job(conn):
    pid, jid = add_project(conn)
    job = db.claim_next_job(conn)
    conn.execute("UPDATE Job SET status='cancel_requested' WHERE id=?", (jid,))
    calls = []
    run_job(conn, job, {"a": stage("a", calls), "b": stage("b", calls)})
    assert calls == []  # cancelled before it started
    assert row(conn, "Job", jid)["status"] == "cancelled"
    assert row(conn, "Project", pid)["status"] == "cancelled"


def test_cancel_during_stage_stops_at_next_report(conn):
    pid, jid = add_project(conn)
    calls = []
    def a(ctx):
        conn.execute("UPDATE Job SET status='cancel_requested' WHERE id=?", (jid,))
        calls.append("a")
        ctx.report(0.5)
        calls.append("after report")
    run_job(conn, db.claim_next_job(conn), {"a": a, "b": stage("b", calls)})
    assert calls == ["a"]
    assert row(conn, "Job", jid)["status"] == "cancelled"


def test_user_error_message_kept(conn):
    pid, jid = add_project(conn)
    def boom(ctx):
        raise UserError("Video is private")
    run_job(conn, db.claim_next_job(conn), {"a": boom})
    assert row(conn, "Job", jid)["error"] == "Video is private"
    assert row(conn, "Project", pid)["status"] == "failed"


def test_unexpected_error_is_summarised(conn):
    _, jid = add_project(conn)
    def boom(ctx):
        raise ValueError("bad thing\nmore lines")
    run_job(conn, db.claim_next_job(conn), {"a": boom})
    assert row(conn, "Job", jid)["error"] == "Something went wrong in a: ValueError: bad thing"


def test_progress_is_overall_across_stages(conn):
    _, jid = add_project(conn)
    seen = []
    def a(ctx):
        ctx.report(0.5)
        seen.append(row(conn, "Job", jid)["progress"])
    run_job(conn, db.claim_next_job(conn), {"a": a, "b": stage("b", [])})
    assert seen == [0.25]
