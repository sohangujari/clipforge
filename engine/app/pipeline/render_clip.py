"""Final render: crop the clip to 9:16 following the tracked subject, burn
in the styled subtitles, and encode the output.

Pipeline:
  1. Call track_subject.compute_crop_path() for the clip's time range.
  2. Generate an .ass subtitle file from word timings + style preset.
  3. Build an ffmpeg command: trim → crop → scale 1080×1920 → burn subs → encode.
  4. Update manifest with rendered_path and style_preset_id.
"""

import logging
import subprocess
from pathlib import Path

from clipforge.engine.app.models.schemas import ClipCandidate, JobStatus, SubtitleStylePreset, WordTiming
from clipforge.engine.app.pipeline.fonts import ensure_font
from clipforge.engine.app.pipeline.track_subject import compute_crop_and_layout, compute_crop_path
from clipforge.engine.app.storage import job_dir, read_manifest, read_presets, write_manifest

logger = logging.getLogger(__name__)

# Output dimensions for 9:16 vertical video
OUT_W, OUT_H = 1080, 1920


def _color_to_ass(hex_color: str) -> str:
    """Convert #RRGGBB to ASS color format &HBBGGRR& (BGR, no alpha)."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H00{b}{g}{r}&"
    return "&H00FFFFFF&"


def _ass_position(position: str, auto_pos: str = "bottom") -> tuple[int, int]:
    """Return (alignment, margin_v) for ASS positioning."""
    effective_pos = auto_pos if position == "auto" else position
    if effective_pos == "top":
        return 8, 160      # an8 = top-center
    elif effective_pos == "center":
        return 5, 0        # an5 = center-center (split line)
    else:  # bottom (default)
        return 2, 220      # an2 = bottom-center (above Shorts safe margin)


def _generate_ass(
    words: list[WordTiming],
    preset: SubtitleStylePreset,
    clip_start: float,
    ass_path: Path,
    detected_auto_pos: str = "bottom",
) -> None:
    """Generate an ASS subtitle file with styled, animated captions."""
    if preset.id == "none" or preset.position == "none":
        ass_path.write_text("", encoding="utf-8")
        return

    alignment, margin_v = _ass_position(preset.position, detected_auto_pos)
    primary_color = _color_to_ass(preset.primary_color)
    highlight_color = _color_to_ass(preset.highlight_color)

    # Determine border style (1 = outline, 3 = opaque rounded background box/pill)
    border_style = preset.border_style if preset.border_style in (1, 3) else (3 if preset.bg_color else 1)
    
    if border_style == 3:
        box_color = _color_to_ass(preset.bg_color or "#FFFFFF")
        back_color = box_color
        outline_color = box_color
        outline_width = preset.outline_width if preset.outline_width >= 10 else 20.0
        shadow = 0
    else:
        back_color = _color_to_ass("#000000")
        outline_color = _color_to_ass(preset.outline_color or "#000000")
        outline_width = preset.outline_width or 4.5
        shadow = 2

    # Font size for 1080p vertical
    font_size = preset.font_size or 70

    header = f"""[Script Info]
Title: ClipForge Subtitles
ScriptType: v4.00+
PlayResX: {OUT_W}
PlayResY: {OUT_H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{preset.font_family},{font_size},{primary_color},{highlight_color},{outline_color},{back_color},-1,0,0,0,100,100,1,0,{border_style},{outline_width},{shadow},{alignment},60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    wpg = max(1, preset.words_per_group)

    # Group words
    groups: list[list[WordTiming]] = []
    for i in range(0, len(words), wpg):
        groups.append(words[i:i + wpg])

    for group in groups:
        if not group:
            continue

        g_start = group[0].start - clip_start
        g_end = group[-1].end - clip_start

        if g_start < 0:
            g_start = 0
        if g_end <= g_start:
            g_end = g_start + 0.5

        start_ts = _format_ass_time(g_start)
        end_ts = _format_ass_time(g_end)

        # Build text with word-level highlight animation
        text_parts = []
        for w in group:
            kara_cs = max(1, int((w.end - w.start) * 100))
            word_str = w.word.upper() if preset.id != "clean-minimal" else w.word

            if preset.animation == "pop":
                text_parts.append(f"{{\\kf{kara_cs}}}{word_str}")
            elif preset.animation == "bounce":
                text_parts.append(f"{{\\k{kara_cs}}}{word_str}")
            elif preset.animation == "fade":
                text_parts.append(f"{{\\kf{kara_cs}}}{word_str}")
            else:
                text_parts.append(word_str)

        text = " ".join(text_parts)

        # Add animation overrides
        if preset.animation == "pop":
            text = f"{{\\fad(80,80)\\an{alignment}}}" + text
        elif preset.animation == "fade":
            text = f"{{\\fad(150,150)\\an{alignment}}}" + text
        elif preset.animation == "bounce":
            text = f"{{\\fad(60,60)\\an{alignment}}}" + text

        events.append(
            f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{text}"
        )

    ass_content = header + "\n".join(events) + "\n"
    ass_path.write_text(ass_content, encoding="utf-8")
    logger.info("Generated ASS subtitle file: %s (%d groups, pos: %s)", ass_path.name, len(groups), alignment)


def _format_ass_time(seconds: float) -> str:
    """Format seconds to ASS timestamp H:MM:SS.cc"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _build_crop_filter(
    crop_path: list[tuple[float, float]],
    src_width: int,
    src_height: int,
    clip_start: float,
) -> str:
    """Build an ffmpeg crop filter from the tracking keyframes.

    For simplicity, we compute the average crop position and use a static
    crop. For v1 this avoids the complexity of sendcmd/zoompan while still
    centering on the speaker.
    """
    if not crop_path:
        # Center crop
        crop_w = int(src_height * 9 / 16)
        crop_x = (src_width - crop_w) // 2
        return f"crop={crop_w}:{src_height}:{crop_x}:0"

    # Compute weighted average x position
    avg_x = sum(x for _, x in crop_path) / len(crop_path)

    # Calculate crop dimensions (9:16 from full height)
    crop_w = int(src_height * 9 / 16)
    if crop_w > src_width:
        crop_w = src_width

    # Convert fraction to pixel position
    crop_x = int(avg_x * src_width - crop_w / 2)
    crop_x = max(0, min(src_width - crop_w, crop_x))

    return f"crop={crop_w}:{src_height}:{crop_x}:0"


def _get_video_dimensions(video_path: Path) -> tuple[int, int]:
    """Get width and height of the video."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0:s=x",
            str(video_path),
        ],
        capture_output=True, text=True,
    )
    parts = result.stdout.strip().split("x")
    if len(parts) == 2:
        return int(parts[0]), int(parts[1])
    raise RuntimeError(f"Cannot determine video dimensions: {result.stdout}")


def render_clip(job_id: str, clip_id: str, style_preset_id: str, overrides: dict = None) -> None:
    """Render a single clip: track → crop → subtitle → encode."""
    logger.info("=== Render started: job=%s clip=%s ===", job_id, clip_id)

    data = read_manifest(job_id)
    clip_data = next((c for c in data.get("clips", []) if c["id"] == clip_id), None)
    if clip_data is None:
        raise ValueError(f"Clip {clip_id} not found in job {job_id}")

    clip = ClipCandidate(**clip_data)

    try:
        # Update status to rendering
        data["job"]["status"] = JobStatus.rendering.value
        write_manifest(job_id, data)

        # Find the style preset
        presets = read_presets()
        preset_data = next((p for p in presets if p["id"] == style_preset_id), None)
        if preset_data is None:
            raise ValueError(f"Style preset {style_preset_id} not found")
    
        # Apply overrides
        if overrides:
            preset_data.update(overrides)
            
        preset = SubtitleStylePreset(**preset_data)

        # Ensure font is downloaded
        fonts_dir = ensure_font(preset.font_family)

        # Paths
        source_video_path = job_dir(job_id) / "source_video.mp4"
        source_audio_path = job_dir(job_id) / "source_audio.mp3"
        clips_dir = job_dir(job_id) / "clips"
        clips_dir.mkdir(parents=True, exist_ok=True)
        output_path = clips_dir / f"{clip_id}.mp4"
        ass_path = clips_dir / f"{clip_id}.ass"

        # Get source video dimensions
        src_w, src_h = _get_video_dimensions(source_video_path)
        logger.info("Source dimensions: %dx%d", src_w, src_h)

        # Track subject and detect layout
        try:
            crop_path, auto_pos = compute_crop_and_layout(source_video_path, clip.start, clip.end)
        except Exception as e:
            logger.warning("Face tracking failed, using center crop: %s", e)
            crop_path = [(clip.start, 0.5), (clip.end, 0.5)]
            auto_pos = "bottom"

        # Generate ASS subtitles
        words = clip.hinglish_words if clip.hinglish_words else clip.transcript_words
        _generate_ass(words, preset, clip.start, ass_path, detected_auto_pos=auto_pos)

        # Build ffmpeg command
        crop_filter = _build_crop_filter(crop_path, src_w, src_h, clip.start)

        # Escape the ASS path for ffmpeg filter (colons and backslashes)
        ass_escaped = str(ass_path).replace("\\", "/").replace(":", "\\:")
        fonts_escaped = str(fonts_dir).replace("\\", "/").replace(":", "\\:")

        if preset.id == "none" or preset.position == "none":
            filter_complex = (
                f"{crop_filter},"
                f"scale={OUT_W}:{OUT_H}:flags=lanczos+accurate_rnd"
            )
        else:
            filter_complex = (
                f"{crop_filter},"
                f"scale={OUT_W}:{OUT_H}:flags=lanczos+accurate_rnd,"
                f"subtitles=f='{ass_escaped}':fontsdir='{fonts_escaped}'"
            )

        progress_file = clips_dir / f"{clip_id}_progress.log"
        progress_file.write_text("")

        cmd = [
            "ffmpeg", "-y",
            "-threads", "0",
            "-progress", str(progress_file),
            "-ss", str(clip.start),
            "-to", str(clip.end),
            "-i", str(source_video_path),
            "-ss", str(clip.start),
            "-to", str(clip.end),
            "-i", str(source_audio_path),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-vf", filter_complex,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "19",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "44100",
            "-movflags", "+faststart",
            str(output_path),
        ]

        logger.info("Running ffmpeg: %s", " ".join(cmd))
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        import time
        last_pct = -1
        total_duration_us = (clip.end - clip.start) * 1_000_000

        while process.poll() is None:
            try:
                if progress_file.exists():
                    content = progress_file.read_text()
                    lines = content.splitlines()
                    last_time = None
                    for line in reversed(lines):
                        if line.startswith("out_time_us="):
                            last_time = line.split("=")[1]
                            break
                    if last_time and last_time.lstrip("-").isdigit():
                        current_us = int(last_time)
                        pct = int((current_us / total_duration_us) * 100)
                        pct = max(0, min(99, pct))
                        if pct > last_pct:
                            last_pct = pct
                            m_data = read_manifest(job_id)
                            for c in m_data.get("clips", []):
                                if c["id"] == clip_id:
                                    c["render_progress"] = pct
                                    break
                            write_manifest(job_id, m_data)
            except Exception:
                pass
            time.sleep(0.1)

        stdout, stderr = process.communicate()

        if progress_file.exists():
            progress_file.unlink()

        if process.returncode != 0:
            logger.error("ffmpeg stderr: %s", stderr[-1000:])
            raise RuntimeError(
                f"ffmpeg render failed (exit {process.returncode}): "
                f"{stderr[-500:]}"
            )

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("ffmpeg produced no output file")

        logger.info(
            "Render complete: %s (%.1f MB)",
            output_path.name, output_path.stat().st_size / 1_048_576,
        )

        # Update manifest
        data = read_manifest(job_id)
        for c in data.get("clips", []):
            if c["id"] == clip_id:
                c["rendered_path"] = str(output_path)
                c["style_preset_id"] = style_preset_id
                c["render_progress"] = 100
                break

        # Check if all clips that should be rendered are done
        data["job"]["status"] = JobStatus.ready_for_review.value
        write_manifest(job_id, data)
        logger.info("=== Render finished: job=%s clip=%s ===", job_id, clip_id)
    except Exception as err:
        logger.exception("Render failed for job=%s clip=%s: %s", job_id, clip_id, err)
        try:
            err_data = read_manifest(job_id)
            err_data["job"]["status"] = JobStatus.ready_for_review.value
            for c in err_data.get("clips", []):
                if c["id"] == clip_id:
                    c["render_progress"] = None
                    break
            write_manifest(job_id, err_data)
        except Exception:
            pass
        raise
