from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from clipforge.engine.app.models.schemas import RenderRequest
from clipforge.engine.app.pipeline.render_clip import render_clip
from clipforge.engine.app.storage import read_manifest

router = APIRouter(prefix="/jobs/{job_id}", tags=["render"])


@router.post("/render")
def start_render(job_id: str, payload: RenderRequest, background_tasks: BackgroundTasks) -> dict:
    try:
        read_manifest(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")

    overrides = {
        "font_family": payload.font_family,
        "primary_color": payload.primary_color,
        "highlight_color": payload.highlight_color,
        "outline_color": payload.outline_color,
        "bg_color": payload.bg_color,
        "border_style": payload.border_style,
        "position": payload.position,
    }
    # Remove None values
    overrides = {k: v for k, v in overrides.items() if v is not None}

    background_tasks.add_task(render_clip, job_id, payload.clip_id, payload.style_preset_id, overrides)
    return {"status": "rendering_started", "clip_id": payload.clip_id}
