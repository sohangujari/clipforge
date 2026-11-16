"""Raw SQL over the Prisma-managed SQLite file. Column names are the contract with web/prisma/schema.prisma.
DateTimes are ISO-8601 text with milliseconds and +00:00, matching what the Prisma adapter writes."""
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .paths import data_dir


def now_iso(delta_s: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_s)).isoformat(timespec="milliseconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(data_dir() / "clipforge.db", isolation_level=None, timeout=5)
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@dataclass
class Job:
    id: str
    project_id: str
    status: str
    stage: str | None
    stage_done: list[str]
    progress: float
    type: str = "ingest"
    payload: dict | None = None


MAX_ATTEMPTS = 3
TOO_MANY = ("Stopped after 3 attempts — the worker kept stopping during this job (often out of memory). "
            "Try a smaller transcription model in Settings → Defaults, then Retry.")


def claim_next_job(conn) -> Job | None:
    # Jobs that already crashed the worker 3 times are failed instead of looping forever.
    for (jid,) in conn.execute("SELECT id FROM Job WHERE status='queued' AND attempts >= ?", (MAX_ATTEMPTS,)).fetchall():
        fail_job(conn, jid, TOO_MANY)
    r = conn.execute(
        "UPDATE Job SET status='running', attempts=attempts+1, heartbeat=?, updatedAt=? "
        "WHERE id=(SELECT id FROM Job WHERE status='queued' ORDER BY createdAt LIMIT 1) "
        "RETURNING id, projectId, status, stage, stageDone, progress, type, payload",
        (now_iso(), now_iso()),
    ).fetchone()
    if not r:
        return None
    if r[6] != "render":  # exporting doesn't take the project away from the user
        conn.execute("UPDATE Project SET status='processing', updatedAt=? WHERE id=?", (now_iso(), r[1]))
    return Job(r[0], r[1], r[2], r[3], json.loads(r[4] or "[]"), r[5], r[6] or "ingest", json.loads(r[7]) if r[7] else {})


def update_job(conn, job_id: str, *, stage: str | None = None, progress: float | None = None, message: str | None = None,
               clear_message: bool = False) -> None:
    sets, vals = ["heartbeat=?", "updatedAt=?"], [now_iso(), now_iso()]
    if stage is not None:
        sets.append("stage=?"); vals.append(stage)
    if progress is not None:
        sets.append("progress=?"); vals.append(round(progress, 4))
    if message is not None or clear_message:
        sets.append("message=?"); vals.append(message)
    conn.execute(f"UPDATE Job SET {', '.join(sets)} WHERE id=?", (*vals, job_id))


def mark_stage_done(conn, job_id: str, stage: str) -> None:
    done = json.loads(conn.execute("SELECT stageDone FROM Job WHERE id=?", (job_id,)).fetchone()[0] or "[]")
    if stage not in done:
        done.append(stage)
    conn.execute("UPDATE Job SET stageDone=?, updatedAt=? WHERE id=?", (json.dumps(done), now_iso(), job_id))


def _end(conn, job_id: str, job_status: str, project_status: str, error: str | None = None) -> None:
    pid, jtype = conn.execute("SELECT projectId, type FROM Job WHERE id=?", (job_id,)).fetchone()
    conn.execute("UPDATE Job SET status=?, error=?, message=NULL, updatedAt=? WHERE id=?", (job_status, error, now_iso(), job_id))
    if jtype == "render":
        return  # the export's result lives on the job; the project's status and warning are untouched
    if jtype != "ingest" and project_status != "ready":
        # a failed/cancelled Find clips or Search leaves the transcript and existing clips usable
        conn.execute("UPDATE Project SET status='ready', warning=COALESCE(?, warning), updatedAt=? WHERE id=?", (error, now_iso(), pid))
        return
    conn.execute("UPDATE Project SET status=?, updatedAt=? WHERE id=?", (project_status, now_iso(), pid))


def finish_job(conn, job_id: str) -> None:
    conn.execute("UPDATE Job SET progress=1 WHERE id=?", (job_id,))
    _end(conn, job_id, "done", "ready")


def fail_job(conn, job_id: str, error: str) -> None:
    _end(conn, job_id, "failed", "failed", error[:500])


def cancel_job(conn, job_id: str) -> None:
    _end(conn, job_id, "cancelled", "cancelled")


def is_cancel_requested(conn, job_id: str) -> bool:
    r = conn.execute("SELECT status FROM Job WHERE id=?", (job_id,)).fetchone()
    return bool(r) and r[0] in ("cancel_requested", "cancelled")  # 'cancelled' if the web cancelled just as we claimed it


def recover_on_start(conn) -> int:
    """Called once at startup, while holding the single-worker lock, so no other worker can own these jobs.
    Interrupted jobs resume right away; cancels made while the worker was down are honoured."""
    for (jid,) in conn.execute("SELECT id FROM Job WHERE status='cancel_requested'").fetchall():
        cancel_job(conn, jid)
    return conn.execute("UPDATE Job SET status='queued', updatedAt=? WHERE status='running'", (now_iso(),)).rowcount


def requeue_stale(conn, older_than_s: float = 120) -> int:
    """Jobs left 'running' by a killed worker go back to the queue (they resume from their checkpoints)."""
    return conn.execute(
        "UPDATE Job SET status='queued', updatedAt=? WHERE status IN ('running','cancel_requested') AND (heartbeat IS NULL OR heartbeat < ?)",
        (now_iso(), now_iso(-older_than_s)),
    ).rowcount


def get_project(conn, project_id: str) -> dict:
    conn.row_factory = sqlite3.Row
    try:
        r = conn.execute("SELECT * FROM Project WHERE id=?", (project_id,)).fetchone()
    finally:
        conn.row_factory = None
    p = dict(r)
    p["settings"] = json.loads(p["settings"] or "{}")
    return p


PROJECT_FIELDS = {"title", "sourceFile", "durationSec", "language", "warning", "contentType"}


def update_project(conn, project_id: str, **fields) -> None:
    bad = set(fields) - PROJECT_FIELDS
    if bad:
        raise ValueError(f"not writable from the worker: {bad}")
    if fields:
        cols = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE Project SET {cols}, updatedAt=? WHERE id=?", (*fields.values(), now_iso(), project_id))
