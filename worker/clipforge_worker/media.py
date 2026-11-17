import json
import re
import subprocess
from pathlib import Path
from typing import Callable

from .errors import UserError


def source_path(ctx) -> Path:
    rel = ctx.project.get("sourceFile")
    p = ctx.data_dir / rel if rel else None
    if not p or not p.is_file():
        raise UserError("The source video is missing — delete this project and add the video again")
    return p


def probe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise UserError("This file isn't a video ClipForge can read")
    info = json.loads(out.stdout)
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    w, h = (int(video["width"]), int(video["height"])) if video else (0, 0)
    rotation = next((int(d.get("rotation", 0)) for d in (video or {}).get("side_data_list", []) if "rotation" in d), 0)
    if rotation % 180:  # phone videos: FFmpeg decodes them upright, so report the upright size
        w, h = h, w
    num, _, den = (video or {}).get("avg_frame_rate", "0/0").partition("/")
    fps = float(num) / float(den) if den and float(den) else 0.0
    return {
        "duration": float(info.get("format", {}).get("duration") or 0),
        "fps": min(60.0, max(24.0, round(fps, 3))) if fps else 30.0,  # the export re-times to this constant rate
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "width": w,
        "height": h,
    }


def ffmpeg(args: list[str], out: Path, duration: float = 0, on_progress: Callable[[float], None] | None = None) -> bool:
    """Runs ffmpeg into out.tmp and renames on success (so a killed run never leaves a 'finished-looking' file).
    Returns False on failure."""
    tmp = out.with_name(out.stem + ".tmp" + out.suffix)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1", *args, str(tmp)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)  # an unread stderr pipe can fill and hang ffmpeg
    try:
        for line in proc.stdout:
            if on_progress and duration > 0 and line.startswith("out_time_us=") and line[12:].strip().isdigit():
                on_progress(min(1.0, int(line[12:]) / 1e6 / duration))
        proc.wait()
    except BaseException:
        proc.kill(); proc.wait(); tmp.unlink(missing_ok=True)
        raise
    if proc.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(out)
    return True


def mean_volume_db(wav: Path) -> float:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(wav), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    m = re.search(r"mean_volume:\s*(-?[\d.]+|-inf) dB", out.stderr)
    return float("-inf") if not m or m.group(1) == "-inf" else float(m.group(1))
