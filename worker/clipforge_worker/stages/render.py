"""Export job: render each clip from the ORIGINAL video with the editor's choices; optionally ZIP them.
Outputs data/renders/<clipId>-<res>.mp4 and data/renders/<projectId>-clips.zip. No model runs here (8 GB rule)."""
import json
import os
import subprocess
import zipfile
from functools import cache

from ..errors import UserError
from ..clips.reframe import apply_focus, minus_focus
from ..media import probe
from ..render.ass import FONTS_DIR, build_ass
from ..render.cuts import kept_duration, middle_ranges, retime_words
from ..render.graph import build_command, output_size, safe_filename
from . import faces, speakers


@cache
def encoder() -> str:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return "h264_videotoolbox" if "h264_videotoolbox" in out else "libx264"


def _words(edit: dict, words: list, start: float, end: float, keep: list) -> list:
    """Subtitle words on the finished clip's clock (cuts removed): the same list the editor preview draws."""
    if not edit["subtitlesOn"]:
        return []
    src = edit.get("words") or words
    return retime_words([w for w in src if w["s"] >= start - 0.05 and w["e"] <= end + 0.05], keep)


def _keep(edit: dict, start: float, end: float) -> list:
    """The saved cut list, clamped to what the video allows; none saved (or all cut) → the whole trim."""
    keep = [[max(a, start), min(b, end)] for a, b in edit.get("keep") or []]
    return [r for r in keep if r[1] - r[0] > 0.05] or [[start, end]]


def _bumpers(ctx, edit: dict):
    """(intro, outro) from the brand kit, each (path, has_audio, duration) or None."""
    if not edit.get("bumpers"):
        return None, None
    out = []
    for key in ("introPath", "outroPath"):
        rel = edit["brand"].get(key)
        p = ctx.data_dir / rel if rel else None
        if p and p.is_file():
            i = probe(p)
            out.append((p, i["has_audio"], i["duration"]))
        else:
            out.append(None)
    return tuple(out)


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


SPEAKER_LAYOUTS = ("active-speaker", "split", "grid")
SPEAKER_COLORS = ["#F26B5B", "#5B8DF2", "#3FA796", "#E2B33C"]  # web/lib/speakers.ts


def _speaker_colors(project: dict) -> list:
    """Each speaker's colour: the one picked in the editor, else the default (web/lib/speakers.ts speakerList)."""
    saved = json.loads(project.get("speakers") or "[]")
    return [saved[i]["color"] if i < len(saved) else SPEAKER_COLORS[i % 4] for i in range(max(len(saved), 4))]


def _people(ctx, payload: dict, ids: list):
    """people.json, when a clip to render uses a speaker layout (detected now for projects from before Phase 6)."""
    rows = [ctx.conn.execute("SELECT edit FROM Clip WHERE id=?", (cid,)).fetchone() for cid in ids]
    layouts = {json.loads(r[0])["layoutId"] for r in rows if r and r[0]} | {e["layoutId"] for e in (payload.get("edits") or {}).values()}
    if not layouts & set(SPEAKER_LAYOUTS):
        return None
    speakers.run(ctx)
    p = ctx.media_dir / "people.json"
    return json.loads(p.read_text()) if p.exists() else None


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
    tj = json.loads(track.read_text()) if track.exists() else {"keyframes": [[0, 0.5, 0.5]]}  # face detection failed: centre
    keyframes, wide = tj["keyframes"], tj.get("wide", [])
    people = _people(ctx, payload, ids)
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
        keep = _keep(edit, start, end)
        rel = [[a - start, b - start] for a, b in keep]
        hook = edit.get("hook") or {}
        layout = edit["layoutId"]
        kf = people["track"] if people and layout in SPEAKER_LAYOUTS else keyframes  # speaker layouts follow whoever talks
        focus = (edit.get("focus") or []) if layout in ("single", "active-speaker") else []  # shots framed by hand in the editor
        kf, clip_wide = apply_focus(kf, focus), minus_focus(wide, focus)
        rows = {**people[layout], "faceH": people["faceH"]} if people and layout in ("split", "grid") else None
        zooms = [[a - start, b - start] for a, b in edit.get("zooms") or []] if layout in ("single", "active-speaker") else []
        intro, outro = _bumpers(ctx, edit)
        total = kept_duration(keep) + sum(b[2] for b in (intro, outro) if b)
        label = f"Rendering clip {n + 1} of {len(ids)}" if len(ids) > 1 else "Rendering"
        ctx.report(n / len(ids), label)
        W, H = output_size(edit["aspect"], "1080p")  # ASS is laid out at 1080p; libass scales it to 720p
        ass_name, out_name = f"{cid}.ass", f"{cid}-{res}.tmp.mp4"
        (out_dir / ass_name).write_text(build_ass({"style": edit["style"], "words": _words(edit, words, start, end, keep), "width": W, "height": H,
                                                   "duration": kept_duration(keep), "watermarkText": _watermark_text(edit),
                                                   "speakerColors": _speaker_colors(ctx.project) if edit.get("speakerColors") else None,
                                                   "hook": {"text": hook["text"], "end": 3} if hook.get("on") and hook.get("text") else None,
                                                   "middle": middle_ranges([r for r in rows["ranges"] if r[1] > start and r[0] < end], keep,
                                                                           edit["aspect"] != "16:9") if rows else None}))
        cmd = build_command(src, out_name, edit, kf, info["width"], info["height"], start, end, _logo(ctx, edit), ass_name, encoder(),
                            keep=rel, zooms=zooms, fps=info["fps"], has_audio=info["has_audio"], bumpers=(intro, outro), rows=rows, wide=clip_wide)
        proc = subprocess.Popen(cmd, cwd=out_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for line in proc.stdout:
                if line.startswith("out_time_us=") and line[12:].strip().isdigit():
                    ctx.report((n + min(1.0, int(line[12:]) / 1e6 / total)) / len(ids), label)
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
