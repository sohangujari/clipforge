"""Export job: render each clip from the ORIGINAL video with the editor's choices; optionally ZIP them.
Outputs data/renders/<clipId>-<res>.mp4 and data/renders/<projectId>-clips.zip. No model runs here (8 GB rule)."""
import json
import os
import subprocess
import zipfile
from functools import cache

from ..errors import UserError
from ..media import probe
from ..render.ass import FONTS_DIR, build_ass
from ..render.graph import build_command, output_size, safe_filename
from . import faces


@cache
def encoder() -> str:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return "h264_videotoolbox" if "h264_videotoolbox" in out else "libx264"


def _words(edit: dict, words: list, start: float, end: float) -> list:
    if not edit["subtitlesOn"]:
        return []
    src = edit.get("words") or words
    return [{"w": w["w"], "s": w["s"] - start, "e": w["e"] - start} for w in src if w["s"] >= start - 0.05 and w["e"] <= end + 0.05]


def _watermark_text(edit: dict):
    b = edit["brand"]
    t = b.get("text") or {}
    if not edit["watermarkOn"] or b.get("logoPath") or not t.get("value"):
        return None
    return {"value": t["value"], "font": t.get("font", "Geist"), "color": t.get("color", "#FFFFFF"), "opacity": b["opacity"] * t.get("opacity", 70) / 100,
            "position": b["position"], "marginPct": b["marginPct"], "sizePct": b["sizePct"]}


def _logo(ctx, edit: dict):
    b = edit["brand"]
    if not edit["watermarkOn"] or not b.get("logoPath"):
        return None
    rel = b.get("logoPngPath") if b["logoPath"].endswith(".svg") else b["logoPath"]  # FFmpeg can't read SVG
    p = ctx.data_dir / rel if rel else None
    return p if p and p.is_file() else None


def _brand_kit(conn) -> dict:
    r = conn.execute("SELECT value FROM Setting WHERE key='brandKit'").fetchone()
    return {"position": "br", "opacity": 80, "sizePct": 12, "marginPct": 4, **(json.loads(r[0]) if r else {})}


def run(ctx) -> None:
    payload = ctx.job.payload or {}
    ids, res = payload.get("clipIds") or [], payload.get("resolution", "1080p")
    out_dir = ctx.data_dir / "renders"
    out_dir.mkdir(exist_ok=True)
    fonts = out_dir / ".fonts"
    if fonts.is_symlink() and fonts.resolve() != FONTS_DIR.resolve():
        fonts.unlink()  # the ClipForge folder was moved or renamed
    if not fonts.exists():
        fonts.symlink_to(FONTS_DIR, target_is_directory=True)
    src = ctx.data_dir / (ctx.project.get("sourceFile") or "")
    if not src.is_file():
        raise UserError("The original video is missing — import it again to export clips")
    info = probe(src)
    duration = info["duration"] or float(ctx.project.get("durationSec") or 0)
    if not (ctx.media_dir / "track.json").exists():
        faces.run(ctx)  # projects from before Phase 4
    track = ctx.media_dir / "track.json"
    keyframes = json.loads(track.read_text())["keyframes"] if track.exists() else [[0, 0.5, 0.5]]  # face detection failed: centre
    brand_kit = _brand_kit(ctx.conn)
    words = json.loads((ctx.media_dir / "transcript.json").read_text())["words"]

    done = []
    for n, cid in enumerate(ids):
        r = ctx.conn.execute("SELECT titles, edit FROM Clip WHERE id=? AND projectId=?", (cid, ctx.job.project_id)).fetchone()
        saved = json.loads(r[1]) if r and r[1] else (payload.get("edits") or {}).get(cid)
        if not saved:
            raise UserError("A clip to export was deleted — refresh the clips page and try again")
        edit = {**saved, "resolution": res, "brand": saved.get("brand") or brand_kit}  # no per-clip brand: today's Settings
        start, end = edit["trim"]["start"], min(edit["trim"]["end"], duration)
        if end - start < 0.2:
            raise UserError("This clip is shorter than the video allows — check its trim")
        label = f"Rendering clip {n + 1} of {len(ids)}" if len(ids) > 1 else "Rendering"
        ctx.report(n / len(ids), label)
        W, H = output_size(edit["aspect"], "1080p")  # ASS is laid out at 1080p; libass scales it to 720p
        ass_name, out_name = f"{cid}.ass", f"{cid}-{res}.tmp.mp4"
        (out_dir / ass_name).write_text(build_ass({"style": edit["style"], "words": _words(edit, words, start, end), "width": W, "height": H,
                                                   "duration": end - start, "watermarkText": _watermark_text(edit)}))
        cmd = build_command(src, out_name, edit, keyframes, info["width"], info["height"], start, end, _logo(ctx, edit), ass_name, encoder())
        proc = subprocess.Popen(cmd, cwd=out_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for line in proc.stdout:
                if line.startswith("out_time_us=") and line[12:].strip().isdigit():
                    ctx.report((n + min(1.0, int(line[12:]) / 1e6 / (end - start))) / len(ids), label)
            err = proc.stderr.read()
            if proc.wait() != 0:
                raise RuntimeError("FFmpeg failed: " + " | ".join(err.strip().splitlines()[-3:]))
        finally:
            if proc.poll() is None:
                proc.kill()  # cancelled mid-render
                proc.wait()
            (out_dir / ass_name).unlink(missing_ok=True)
        os.replace(out_dir / out_name, out_dir / f"{cid}-{res}.mp4")
        done.append((cid, json.loads(r[0])[0] if r[0] else ""))

    if payload.get("zip"):
        ctx.report(0.99, "Making the ZIP")
        tmp = out_dir / f"{ctx.job.project_id}-clips.tmp.zip"
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:  # MP4s don't compress further
            for i, (cid, title) in enumerate(done):
                z.write(out_dir / f"{cid}-{res}.mp4", f"{i + 1:02d} {safe_filename(title, 'mp4')}")
        os.replace(tmp, out_dir / f"{ctx.job.project_id}-clips.zip")
    ctx.report(1.0)
