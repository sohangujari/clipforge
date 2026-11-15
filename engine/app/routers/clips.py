import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from clipforge.engine.app.models.schemas import ClipCandidate
from clipforge.engine.app.storage import read_manifest, write_manifest

router = APIRouter(prefix="/jobs/{job_id}/clips", tags=["clips"])


@router.get("", response_model=list[ClipCandidate])
def list_clips(job_id: str) -> list[ClipCandidate]:
    try:
        data = read_manifest(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    return [ClipCandidate(**c) for c in data.get("clips", [])]


@router.patch("/{clip_id}", response_model=ClipCandidate)
def update_clip(job_id: str, clip_id: str, patch: dict) -> ClipCandidate:
    """Partial update for title/description/tags/style_preset_id etc.
    Kept as a raw dict rather than a strict model so the frontend can send
    just the fields it changed.
    """
    try:
        data = read_manifest(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")

    clips = data.get("clips", [])
    for c in clips:
        if c["id"] == clip_id:
            c.update(patch)
            write_manifest(job_id, data)
            return ClipCandidate(**c)

    raise HTTPException(status_code=404, detail="Clip not found")


@router.get("/{clip_id}/download")
def download_clip(job_id: str, clip_id: str):
    try:
        data = read_manifest(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")

    clip = next((c for c in data.get("clips", []) if c["id"] == clip_id), None)
    if not clip or not clip.get("rendered_path"):
        raise HTTPException(status_code=404, detail="Rendered clip not found")
        
    path = clip["rendered_path"]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing on disk")
        
    return FileResponse(path, media_type="video/mp4", filename=f"clipforge_{clip_id}.mp4", content_disposition_type="attachment")

@router.get("/{clip_id}/stream")
def stream_clip(job_id: str, clip_id: str):
    try:
        data = read_manifest(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")

    clip = next((c for c in data.get("clips", []) if c["id"] == clip_id), None)
    if not clip or not clip.get("rendered_path"):
        raise HTTPException(status_code=404, detail="Rendered clip not found")
        
    path = clip["rendered_path"]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing on disk")
        
    return FileResponse(path, media_type="video/mp4", content_disposition_type="inline")
