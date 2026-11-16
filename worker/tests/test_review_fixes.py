"""Regression tests for the Phase 2 review findings."""
import os
import stat
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from clipforge_worker import db, llm, media
from clipforge_worker.runner import run_job
from clipforge_worker.stages import importer
from conftest import add_project, ctx_for, row


def test_token_created_by_worker_when_missing(data_dir, monkeypatch):  # C1
    monkeypatch.setenv("CLIPFORGE_WEB_PORT", "9")
    with pytest.raises(llm.LlmUnavailable):
        llm.call_llm("hinglish", {"words": ["x"]}, timeout=2)
    tok = data_dir / ".worker-token"
    assert tok.exists() and len(tok.read_text().strip()) == 64
    assert stat.S_IMODE(tok.stat().st_mode) == 0o600
    assert llm.ensure_token() == tok.read_text().strip()  # stable once created


def test_stale_cancel_requested_becomes_cancelled(conn, ago):  # I1
    pid, jid = add_project(conn, job_status="cancel_requested", heartbeat=ago(minutes=10))
    db.recover_on_start(conn)
    assert row(conn, "Job", jid)["status"] == "cancelled"
    assert row(conn, "Project", pid)["status"] == "cancelled"


def test_startup_requeues_running_jobs_immediately(conn, ago):  # I6
    _, jid = add_project(conn, job_status="running", heartbeat=ago(seconds=5))
    db.recover_on_start(conn)
    assert row(conn, "Job", jid)["status"] == "queued"


def test_job_cancelled_directly_is_treated_as_cancel(conn):  # I2
    pid, jid = add_project(conn)
    job = db.claim_next_job(conn)
    conn.execute("UPDATE Job SET status='cancelled' WHERE id=?", (jid,))  # web won the race
    calls = []
    run_job(conn, job, {"a": lambda ctx: calls.append("a")})
    assert calls == []
    assert row(conn, "Project", pid)["status"] == "cancelled"


def test_resume_ignores_partial_format_files(conn, data_dir, monkeypatch):  # I3
    pid, _ = add_project(conn, source_type="url", source_url="https://x/y")
    m = data_dir / "media" / pid
    m.mkdir(parents=True)
    (m / "source.f137.mp4").write_bytes(b"video only")
    called = []

    class Fake:
        def __init__(self, opts): self.opts = opts
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def extract_info(self, url, download=True):
            called.append(1)
            (m / "source.mp4").write_bytes(b"merged")
            return {"title": "T"}
    monkeypatch.setattr(importer.yt_dlp, "YoutubeDL", Fake)
    importer.run(ctx_for(conn))
    assert called == [1]
    assert row(conn, "Project", pid)["sourceFile"] == f"media/{pid}/source.mp4"


def test_ffmpeg_with_huge_stderr_does_not_hang(tmp_path):  # I4
    out = tmp_path / "o.mp4"
    result = {}
    t = threading.Thread(daemon=True, target=lambda: result.update(ok=media.ffmpeg(
        ["-loglevel", "debug", "-debug_ts", "-f", "lavfi", "-i", "testsrc2=size=320x240:duration=20", "-c:v", "libx264"], out, 20)))
    t.start(); t.join(60)
    assert not t.is_alive(), "ffmpeg hung on a full stderr pipe"
    assert result["ok"] is True


def test_single_worker_lock(data_dir):  # I6
    from clipforge_worker.__main__ import acquire_lock
    a = acquire_lock()
    assert a is not None
    assert acquire_lock() is None
    a.close()


def test_non_json_error_body_is_llm_error(data_dir, monkeypatch):  # M1
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            body = b"<html>Internal Server Error</html>"
            self.send_response(500); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        def log_message(self, *a): pass
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("CLIPFORGE_WEB_PORT", str(srv.server_address[1]))
    try:
        with pytest.raises(llm.LlmError):
            llm.call_llm("hinglish", {"words": ["x"]}, timeout=5)
    finally:
        srv.shutdown()


def test_job_failed_after_three_attempts(conn):  # M6
    pid, jid = add_project(conn)
    conn.execute("UPDATE Job SET attempts=3 WHERE id=?", (jid,))
    assert db.claim_next_job(conn) is None
    j = row(conn, "Job", jid)
    assert j["status"] == "failed" and "3 attempts" in j["error"]
    assert row(conn, "Project", pid)["status"] == "failed"


def test_alive_file_keeps_updating_during_a_long_job(data_dir):
    import time
    from clipforge_worker.__main__ import start_heartbeat
    start_heartbeat(interval=0.1)
    f = data_dir / ".worker-alive"
    time.sleep(0.25)
    first = f.stat().st_mtime_ns
    time.sleep(0.3)  # main thread is "busy" — the heartbeat thread must still touch the file
    assert f.stat().st_mtime_ns > first
