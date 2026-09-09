import uuid

from fastapi import APIRouter, HTTPException

from clipforge.engine.app.models.schemas import SubtitleStylePreset
from clipforge.engine.app.storage import read_presets, write_presets

router = APIRouter(prefix="/presets", tags=["presets"])

_DEFAULT_PRESETS = [
    SubtitleStylePreset(
        id="hormozi",
        name="The Hormozi",
        font_family="Montserrat",
        font_size=68,
        primary_color="#FFFFFF",
        highlight_color="#FFD100",
        outline_color="#000000",
        outline_width=4,
        position="center",
        animation="pop"
    ),
    SubtitleStylePreset(
        id="beast",
        name="The Beast",
        font_family="Anton",
        font_size=76,
        primary_color="#FFFFFF",
        highlight_color="#00E5FF",
        outline_color="#000000",
        outline_width=4,
        position="center",
        animation="bounce"
    ),
    SubtitleStylePreset(
        id="clean-minimal",
        name="Clean minimal",
        font_family="Inter",
        font_size=52,
        primary_color="#FFFFFF",
        highlight_color="#00FF7F",
        outline_width=1,
        position="bottom",
        animation="fade"
    ),
]


@router.get("", response_model=list[SubtitleStylePreset])
def list_presets() -> list[SubtitleStylePreset]:
    stored = read_presets()
    if not stored:
        write_presets([p.model_dump() for p in _DEFAULT_PRESETS])
        return _DEFAULT_PRESETS
    return [SubtitleStylePreset(**p) for p in stored]


@router.post("", response_model=SubtitleStylePreset)
def create_preset(preset: SubtitleStylePreset) -> SubtitleStylePreset:
    presets = read_presets()
    preset.id = preset.id or uuid.uuid4().hex[:8]
    presets.append(preset.model_dump())
    write_presets(presets)
    return preset


@router.delete("/{preset_id}")
def delete_preset(preset_id: str) -> dict:
    presets = read_presets()
    remaining = [p for p in presets if p["id"] != preset_id]
    if len(remaining) == len(presets):
        raise HTTPException(status_code=404, detail="Preset not found")
    write_presets(remaining)
    return {"deleted": preset_id}
