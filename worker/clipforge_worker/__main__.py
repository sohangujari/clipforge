"""ClipForge worker: claims one job at a time from SQLite and runs it through the stages.
Run with: uv run --project worker python -m clipforge_worker"""
import fcntl
import logging
import os
import signal
import sys
import threading
import time

# Plain HTTPS model downloads: Hugging Face's xet transfer throttled to one slow connection on a flaky line and
# never recovered, while plain HTTPS ran at full speed. Both resume interrupted downloads. Set to 0 to use xet.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

from . import db  # noqa: E402
from .paths import data_dir  # noqa: E402
from .runner import run_job  # noqa: E402
from . import signals  # noqa: E402
from .stages import analyze, faces, importer, prepare, render, romanize, search, speakers, transcribe  # noqa: E402

STAGES = {"importing": importer.run, "preparing": prepare.run, "transcribing": transcribe.run, "romanizing": romanize.run,
          "signals": signals.run, "faces": faces.run, "speakers": speakers.run, "analyzing": analyze.run}


def stages_for(job) -> dict:
    """ingest = the full pipeline; analyze = Find clips again on an existing transcript; search = one plain-language query."""
    if job.type == "analyze":
        return {k: STAGES[k] for k in ("signals", "faces", "speakers", "analyzing")}
    if job.type == "search":
        return {"searching": search.run}
    if job.type == "render":
        return {"rendering": render.run}
    return STAGES
IDLE_POLL_S = 1.0
ALIVE_EVERY_S = 5.0

log = logging.getLogger("clipforge.worker")
_stop = False


def _on_signal(signum, _frame):
    global _stop
    _stop = True
    log.info("stopping (a running job resumes from its last finished stage next time)")
    sys.exit(0)  # leaves the job 'running'; requeue_stale picks it up on the next start


def acquire_lock():
    """Only one worker may run: two would load two Whisper models into 8 GB. Returns the open lock file, or None."""
    f = open(data_dir() / ".worker.lock", "w")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return f
    except BlockingIOError:
        f.close()
        return None


def touch_alive() -> None:
    (data_dir() / ".worker-alive").touch()


def start_heartbeat(interval: float = ALIVE_EVERY_S) -> None:
    """Touch data/.worker-alive from a background thread, so the UI knows the worker is alive even mid-job
    (model downloads and long ffmpeg steps report no progress for minutes)."""
    def beat():
        while True:
            try:
                touch_alive()
            except OSError:
                pass
            time.sleep(interval)
    threading.Thread(target=beat, daemon=True, name="heartbeat").start()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="[worker] %(message)s")
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)
    data_dir().mkdir(parents=True, exist_ok=True)
    if transcribe.IS_APPLE_SILICON:
        import mlx.core as mx
        mx.set_cache_limit(512 * 2**20)  # cap MLX's GPU buffer cache: it shares the 8 GB with everything else
    lock = acquire_lock()
    if lock is None:
        log.error("another ClipForge worker is already running — exiting")
        sys.exit(1)
    conn = db.connect()
    if n := db.recover_on_start(conn):
        log.info("resuming %d interrupted job(s)", n)
    start_heartbeat()
    log.info("data dir: %s — waiting for jobs", data_dir())
    while not _stop:
        job = db.claim_next_job(conn)
        if job:
            run_job(conn, job, stages_for(job))
        else:
            time.sleep(IDLE_POLL_S)


if __name__ == "__main__":
    main()
