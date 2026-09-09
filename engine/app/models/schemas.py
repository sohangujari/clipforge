"""Shared data models for ClipForge.

These mirror web/lib/types.ts on the frontend. If you change a field here,
update the TS side to match.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"
    downloading = "downloading"
    transcribing = "transcribing"
    analyzing = "analyzing"
    ready_for_review = "ready_for_review"
    rendering = "rendering"
    done = "done"
    failed = "failed"


class JobCreateRequest(BaseModel):
    youtube_url: str


class Job(BaseModel):
    id: str
    youtube_url: str
    status: JobStatus
    progress: Optional[int] = None
    error: Optional[str] = None
    source_language: Optional[str] = None
    source_title: Optional[str] = None
    created_at: str
    updated_at: str


class WordTiming(BaseModel):
    word: str
    start: float
    end: float


class ClipCandidate(BaseModel):
    id: str
    job_id: str
    start: float
    end: float
    hook_score: float = Field(ge=0, le=1)
    reason: str
    transcript_words: list[WordTiming] = []
    hinglish_words: Optional[list[WordTiming]] = None
    # Set once the user edits/generates metadata for this clip
    title: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = []
    style_preset_id: Optional[str] = None
    rendered_path: Optional[str] = None
    render_progress: Optional[int] = None


class SubtitleStylePreset(BaseModel):
    id: str
    name: str
    font_family: str = "Inter"
    font_size: int = 64
    primary_color: str = "#FFFFFF"
    highlight_color: str = "#FFD100"
    outline_color: str = "#000000"
    outline_width: float = 4.0
    bg_color: Optional[str] = None
    border_style: int = 1  # 1 = outline, 3 = opaque rounded background box
    position: str = "auto"  # "auto" | "bottom" | "center" | "top" | "none"
    animation: str = "pop"  # "pop" | "fade" | "bounce" | "none"
    words_per_group: int = 2


class RenderRequest(BaseModel):
    clip_id: str
    style_preset_id: str
    font_family: Optional[str] = None
    primary_color: Optional[str] = None
    highlight_color: Optional[str] = None
    outline_color: Optional[str] = None
    bg_color: Optional[str] = None
    border_style: Optional[int] = None
    position: Optional[str] = None
