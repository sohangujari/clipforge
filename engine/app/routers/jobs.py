import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException

from clipforge.engine.app.models.schemas import Job, JobCreateRequest, JobStatus
from clipforge.engine.app.pipeline.run_pipeline import run_ingest_pipeline
from clipforge.engine.app.storage import list_job_ids, read_manifest, write_manifest

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


import re

def _extract_video_id(url: str) -> str:
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11})", url)
    return match.group(1) if match else url

@router.post("", response_model=Job)
def create_job(payload: JobCreateRequest, background_tasks: BackgroundTasks) -> Job:
    new_vid_id = _extract_video_id(payload.youtube_url)
    
    # Deduplicate: if a non-failed job for this URL already exists, return it
    for existing_job_id in list_job_ids():
        try:
            data = read_manifest(existing_job_id)
            existing_job = Job(**data["job"])
            if _extract_video_id(existing_job.youtube_url) == new_vid_id and existing_job.status != JobStatus.failed:
                return existing_job
        except (FileNotFoundError, KeyError):
            continue

    job_id = uuid.uuid4().hex[:12]
    job = Job(
        id=job_id,
        youtube_url=payload.youtube_url,
        status=JobStatus.queued,
        created_at=_now(),
        updated_at=_now(),
    )
    write_manifest(job_id, {"job": job.model_dump(), "clips": []})

    background_tasks.add_task(run_ingest_pipeline, job_id)
    return job


@router.get("", response_model=list[Job])
def list_jobs() -> list[Job]:
    jobs = []
    for job_id in list_job_ids():
        try:
            data = read_manifest(job_id)
            jobs.append(Job(**data["job"]))
        except (FileNotFoundError, KeyError):
            continue
    return sorted(jobs, key=lambda j: j.created_at, reverse=True)


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    try:
        data = read_manifest(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    return Job(**data["job"])
