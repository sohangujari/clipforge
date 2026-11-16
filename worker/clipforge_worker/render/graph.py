"""The FFmpeg command for one exported clip: crop (face track) or fit + blurred fill, burned-in ASS, logo, encode.
Crop maths = clips/reframe.py, the same as the editor preview (web/lib/reframe.ts)."""
import re
from pathlib import Path

from ..clips.reframe import center_at, crop_rect

ASPECT = {"9:16": 9 / 16, "1:1": 1.0, "16:9": 16 / 9}
MAX_SEGMENTS = 60


def output_size(aspect: str, res: str) -> tuple[int, int]:
    s, l = (1080, 1920) if res == "1080p" else (720, 1280)
    return {"9:16": (s, l), "1:1": (s, s), "16:9": (l, s)}[aspect]


def _fmt(n: float) -> str:
    return f"{n:.3f}".rstrip("0").rstrip(".")


def crop_x_expr(keyframes, t0: float, dur: float, src_w: int, src_h: int, aspect: float, axis: int = 0) -> str:
    """Crop x (axis 0) or y (axis 1) as an FFmpeg expression of t (clip-relative): piecewise linear between the
    track's keyframes inside the clip, ≤ MAX_SEGMENTS segments. A still crop is a plain number."""
    at = lambda tau: crop_rect(*center_at(keyframes, t0 + tau), src_w, src_h, aspect)[axis]  # noqa: E731
    taus = [0.0] + [k[0] - t0 for k in keyframes if t0 < k[0] < t0 + dur] + [dur]
    pts = []
    for tau in taus:
        v = at(tau)
        if not pts or tau > pts[-1][0]:
            pts.append((tau, v))
    while len(pts) > MAX_SEGMENTS + 1:  # drop the point whose removal changes the path least
        def err(i):
            (ta, va), (tb, vb), (tc, vc) = pts[i - 1], pts[i], pts[i + 1]
            return abs(vb - (va + (vc - va) * (tb - ta) / (tc - ta)))
        pts.pop(min(range(1, len(pts) - 1), key=err))
    if len({v for _, v in pts}) == 1:
        return str(pts[0][1])
    expr = str(pts[-1][1])
    for (ta, va), (tb, vb) in reversed(list(zip(pts, pts[1:]))):
        seg = str(va) if va == vb else f"{va}+({vb - va})*(t-{_fmt(ta)})/{_fmt(tb - ta)}"
        expr = f"if(lt(t,{_fmt(tb)}),{seg},{expr})"
    return expr


def _logo_xy(pos: str, m: int) -> tuple[str, str]:
    col = "c" if len(pos) == 1 else pos[1]
    x = {"l": str(m), "c": "(main_w-overlay_w)/2", "r": f"main_w-overlay_w-{m}"}[col]
    y = {"t": str(m), "m": "(main_h-overlay_h)/2", "c": "(main_h-overlay_h)/2", "b": f"main_h-overlay_h-{m}"}[pos[0]]
    return x, y


def build_command(src: Path, out_name: str, edit: dict, keyframes, src_w: int, src_h: int, start: float, end: float,
                  logo: Path | None, ass_name: str, encoder: str) -> list[str]:
    """Run with cwd = the renders folder: ass_name and '.fonts' are relative there, so no path needs filtergraph escaping."""
    W, H = output_size(edit["aspect"], edit["resolution"])
    dur = end - start
    if edit["layoutId"] == "wide-blur":
        video = (f"[0:v]split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=20:2,eq=brightness=-0.12[bg];"
                 f"[b]scale={W}:{H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]")
    else:
        a = ASPECT[edit["aspect"]]
        _, _, cw, ch = crop_rect(0.5, 0.5, src_w, src_h, a)
        x, y = crop_x_expr(keyframes, start, dur, src_w, src_h, a, 0), crop_x_expr(keyframes, start, dur, src_w, src_h, a, 1)
        video = f"[0:v]crop=w={cw}:h={ch}:x='{x}':y='{y}',scale={W}:{H},setsar=1[v0]"
    graph = f"{video};[v0]subtitles=f={ass_name}:fontsdir=.fonts[v1]"
    inputs = ["-ss", _fmt(start), "-to", _fmt(end), "-i", str(src)]
    if logo:
        b = edit["brand"]
        lw = max(2, round(W * b["sizePct"] / 100) // 2 * 2)
        x, y = _logo_xy(b["position"], round(W * b["marginPct"] / 100))
        graph += (f";[1:v]scale={lw}:-1,format=rgba,colorchannelmixer=aa={_fmt(b['opacity'] / 100)}[lg];"
                  f"[v1][lg]overlay=x={x}:y={y}:format=auto,format=yuv420p[vout]")
        inputs += ["-i", str(logo)]
    else:
        graph += ";[v1]format=yuv420p[vout]"
    enc = (["-c:v", "h264_videotoolbox", "-b:v", "8M" if edit["resolution"] == "1080p" else "5M", "-profile:v", "high"]
           if encoder == "h264_videotoolbox" else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"])
    return ["ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1", *inputs, "-filter_complex", graph,
            "-map", "[vout]", "-map", "0:a?", *enc, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out_name]


def safe_filename(title: str, ext: str) -> str:
    """A download/ZIP name from a clip title: no path or shell-hostile characters, ≤ 80 chars."""
    s = re.sub(r'[/\\:*?"<>|\x00-\x1f]', " ", title or "")
    s = re.sub(r"\s+", " ", s).strip(" .")[:80].strip() or "clip"
    return f"{s}.{ext}"
