"""Metadata generation endpoint — calls GLM to generate SEO-optimized
title, description, and tags for a clip, and patches them into the manifest.
"""

from fastapi import APIRouter, HTTPException

from clipforge.engine.app.models.schemas import ClipCandidate
from clipforge.engine.app.pipeline.metadata import generate_metadata
from clipforge.engine.app.storage import read_manifest, write_manifest

router = APIRouter(prefix="/jobs/{job_id}/clips/{clip_id}", tags=["metadata"])


@router.post("/metadata", response_model=ClipCandidate)
def gen_metadata(job_id: str, clip_id: str) -> ClipCandidate:
    """Generate title/description/tags for a clip using GLM."""
    try:
        data = read_manifest(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")

    clip_data = next((c for c in data.get("clips", []) if c["id"] == clip_id), None)
    if clip_data is None:
        raise HTTPException(status_code=404, detail="Clip not found")

    clip = ClipCandidate(**clip_data)
    meta = generate_metadata(clip)

    # Patch the clip in the manifest
    for c in data["clips"]:
        if c["id"] == clip_id:
            c["title"] = meta["title"]
            c["description"] = meta["description"]
            c["tags"] = meta["tags"]
            break

    write_manifest(job_id, data)
    return ClipCandidate(**next(c for c in data["clips"] if c["id"] == clip_id))
