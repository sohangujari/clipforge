import logging
import traceback
from pathlib import Path
from typing import Callable

from . import db
from .errors import Cancelled, UserError
from .paths import data_dir, media_dir
from .progress import Throttle

log = logging.getLogger("clipforge.worker")


class StageContext:
    def __init__(self, conn, job: db.Job, stage: str, index: int, count: int):
        self.conn, self.job, self.stage = conn, job, stage
        self._index, self._count = index, count
        self._throttle = Throttle()
        self.project = db.get_project(conn, job.project_id)

    @property
    def settings(self) -> dict:
        return self.project["settings"]

    @property
    def data_dir(self) -> Path:
        return data_dir()

    @property
    def media_dir(self) -> Path:
        return media_dir(self.job.project_id)

    def report(self, fraction: float, message: str | None = None) -> None:
        """Stage progress 0..1. Raises Cancelled if the user cancelled."""
        fraction = max(0.0, min(1.0, fraction))
        if message is not None or self._throttle.should_write(fraction):
            overall = (self._index + fraction) / self._count
            db.update_job(self.conn, self.job.id, progress=overall, message=message)
            if db.is_cancel_requested(self.conn, self.job.id):
                raise Cancelled()

    def set_project(self, **fields) -> None:
        db.update_project(self.conn, self.job.project_id, **fields)
        self.project = db.get_project(self.conn, self.job.project_id)


def run_job(conn, job: db.Job, stages: dict[str, Callable[[StageContext], None]]) -> None:
    names = list(stages)
    stage = None
    try:
        for i, stage in enumerate(names):
            if stage in job.stage_done:
                continue
            if db.is_cancel_requested(conn, job.id):
                raise Cancelled()
            db.update_job(conn, job.id, stage=stage, progress=i / len(names), clear_message=True)
            log.info("job %s: %s", job.id[:8], stage)
            stages[stage](StageContext(conn, job, stage, i, len(names)))
            db.mark_stage_done(conn, job.id, stage)
        db.finish_job(conn, job.id)
        log.info("job %s: done", job.id[:8])
    except Cancelled:
        db.cancel_job(conn, job.id)
        log.info("job %s: cancelled", job.id[:8])
    except UserError as e:
        db.fail_job(conn, job.id, str(e))
        log.info("job %s: failed: %s", job.id[:8], e)
    except Exception as e:  # noqa: BLE001 — a background job must never take the worker down
        first = (str(e).splitlines() or [""])[0]
        db.fail_job(conn, job.id, f"Something went wrong in {stage}: {type(e).__name__}: {first}")
        log.error("job %s crashed in %s\n%s", job.id[:8], stage, traceback.format_exc())
