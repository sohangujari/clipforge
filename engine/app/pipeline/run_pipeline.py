"""Pipeline orchestrator: download → transcribe → (Hinglish) → score clips.

Runs in a FastAPI BackgroundTask; any exception marks the job failed
rather than crashing the request that kicked it off. Each stage updates
the job manifest so the frontend can poll for status.
"""

import logging
import traceback
from datetime import datetime, timezone

from clipforge.engine.app.models.schemas import JobStatus
from clipforge.engine.app.pipeline.clip_select import select_clips
from clipforge.engine.app.pipeline.download import download_video
from clipforge.engine.app.pipeline.hinglish import to_hinglish
from clipforge.engine.app.pipeline.transcribe import transcribe
from clipforge.engine.app.storage import read_manifest, write_manifest

logger = logging.getLogger(__name__)


def _touch(data: dict, status: JobStatus, **fields) -> None:
    data["job"]["status"] = status.value
    data["job"]["updated_at"] = datetime.now(timezone.utc).isoformat()
    data["job"].update(fields)


def run_ingest_pipeline(job_id: str) -> None:
    """Download -> transcribe -> (Hinglish if Hindi) -> score clips.
    Runs in a FastAPI BackgroundTask; any exception marks the job failed
    rather than crashing the request that kicked it off.
    """
    logger.info("=== Pipeline started for job %s ===", job_id)
    data = read_manifest(job_id)
    try:
        # --- Download ---
        logger.info("[%s] Stage: downloading", job_id)
        _touch(data, JobStatus.downloading)
        write_manifest(job_id, data)
        video_path, audio_path, title = download_video(job_id, data["job"]["youtube_url"])
        logger.info("[%s] Downloaded: %s", job_id, title)

        # --- Transcribe ---
        logger.info("[%s] Stage: transcribing", job_id)
        _touch(data, JobStatus.transcribing, source_title=title)
        write_manifest(job_id, data)

        language, words = transcribe(job_id, audio_path)
        logger.info("[%s] Transcribed: lang=%s, words=%d", job_id, language, len(words))

        # --- Analyze / Hinglish ---
        logger.info("[%s] Stage: analyzing", job_id)
        _touch(data, JobStatus.analyzing, source_language=language)
        write_manifest(job_id, data)

        if language == "hi":
            logger.info("[%s] Hindi detected — converting to Hinglish", job_id)
            words = to_hinglish(words)

        # --- Clip selection ---
        logger.info("[%s] Selecting clips via GLM", job_id)
        clips = select_clips(job_id, words)
        data["clips"] = [c.model_dump() for c in clips]
        logger.info("[%s] Found %d clip candidates", job_id, len(clips))

        _touch(data, JobStatus.ready_for_review)
        write_manifest(job_id, data)
        logger.info("=== Pipeline completed for job %s ===", job_id)

    except Exception as e:  # noqa: BLE001 - broad on purpose, this is a background job
        logger.error(
            "[%s] Pipeline failed: %s\n%s", job_id, e, traceback.format_exc()
        )
        # Re-read manifest in case it was updated by a stage before the crash
        try:
            data = read_manifest(job_id)
        except Exception:
            pass
        _touch(data, JobStatus.failed, error=str(e))
        write_manifest(job_id, data)
