"""The FFmpeg command for one exported clip: crop (face track) or fit + blurred fill, burned-in ASS, logo, encode.
Crop maths = clips/reframe.py, the same as the editor preview (web/lib/reframe.ts)."""
import re
from pathlib import Path

from ..clips.gaming import GAMING_LAYOUTS, ROUND_R, regions
from ..clips.reframe import center_at, crop_rect, row_scale
from .cuts import zoom_expr

ASPECT = {"9:16": 9 / 16, "1:1": 1.0, "16:9": 16 / 9}
MAX_SEGMENTS = 60


def output_size(aspect: str, res: str) -> tuple[int, int]:
    s, l = (1080, 1920) if res == "1080p" else (720, 1280)
    return {"9:16": (s, l), "1:1": (s, s), "16:9": (l, s)}[aspect]


def _fmt(n: float) -> str:
    return f"{n:.3f}".rstrip("0").rstrip(".")


def crop_x_expr(keyframes, t0: float, dur: float, src_w: int, src_h: int, aspect: float, axis: int = 0, scale: float = 1.0) -> str:
    """Crop x (axis 0) or y (axis 1) as an FFmpeg expression of t (clip-relative): piecewise linear between the
    track's keyframes inside the clip, ≤ MAX_SEGMENTS segments. A still crop is a plain number."""
    at = lambda tau: crop_rect(*center_at(keyframes, t0 + tau), src_w, src_h, aspect, scale)[axis]  # noqa: E731
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


def _crop(keyframes, start, dur, src_w, src_h, aspect, scale=1.0) -> str:
    _, _, cw, ch = crop_rect(0.5, 0.5, src_w, src_h, aspect, scale)
    x, y = (crop_x_expr(keyframes, start, dur, src_w, src_h, aspect, axis, scale) for axis in (0, 1))
    return f"crop=w={cw}:h={ch}:x='{x}':y='{y}'"


def in_clip(ranges, start: float, dur: float) -> list:
    """Plan ranges [s, e, …] cut to the clip, made clip-relative."""
    return [[max(r[0], start) - start, min(r[1], start + dur) - start, *r[2:]] for r in ranges if r[1] > start and r[0] < start + dur]


def _rows(F: str, W: int, H: int, edit: dict, keyframes, rows: dict, start: float, dur: float, src_w: int, src_h: int) -> str | None:
    """Split / Grid: while 2–3 people are on screen, each gets a row (columns at 16:9) on their own crop path; otherwise the
    active-speaker crop. Grid outlines whoever is talking. rows = people.json's plan for the layout + faceH."""
    ranges = in_clip(rows["ranges"], start, dur)
    ks = sorted({r[2] for r in ranges})
    if not ks:
        return None
    vertical = edit["aspect"] != "16:9"
    a = ASPECT[edit["aspect"]]
    labels = "[m]" + "".join(f"[r{k}_{j}]" for k in ks for j in range(k))
    parts = [f"[0:v]fps={F},split={1 + sum(ks)}{labels}", f"[m]{_crop(keyframes, start, dur, src_w, src_h, a)},scale={W}:{H},setsar=1[c0]"]
    cur = "c0"
    for k in ks:
        rw, rh = (W, H // k // 2 * 2) if vertical else (W // k // 2 * 2, H)
        ra = rw / rh
        sc = row_scale(rows.get("faceH"), src_w, src_h, ra)
        for j in range(k):
            parts.append(f"[r{k}_{j}]{_crop(rows['tracks'][str(k)][j], start, dur, src_w, src_h, ra, sc)},scale={rw}:{rh},setsar=1[p{k}_{j}]")
        stack = "vstack" if vertical else "hstack"
        parts.append("".join(f"[p{k}_{j}]" for j in range(k)) + f"{stack}=inputs={k},pad={W}:{H},setsar=1[s{k}]")
        en = "+".join(f"between(t,{_fmt(r[0])},{_fmt(r[1])})" for r in ranges if r[2] == k)
        parts.append(f"[{cur}][s{k}]overlay=0:0:enable='{en}'[o{k}]")
        cur = f"o{k}"
        for j in range(k):  # Grid: an accent outline on whoever is talking
            act = [r for r in in_clip(rows.get("active", []), start, dur) if r[2] == k and r[3] == j]
            if act:
                x, y = (0, j * rh) if vertical else (j * rw, 0)
                en = "+".join(f"between(t,{_fmt(r[0])},{_fmt(r[1])})" for r in act)
                parts.append(f"[{cur}]drawbox=x={x}:y={y}:w={rw}:h={rh}:color=0xF26B5B:t={max(4, W // 135)}:enable='{en}'[h{k}_{j}]")
                cur = f"h{k}_{j}"
    parts[-1] = parts[-1][: parts[-1].rindex("[")] + "[v0]"
    return ";".join(parts)


def _mask(shape: str, w: int, h: int) -> str:
    """Alpha for the PiP bubble: a circle, or a rectangle with rounded corners (the preview clips the same shape)."""
    if shape == "circle":
        return f"if(lte(hypot(X-{w / 2},Y-{h / 2}),{w / 2}),255,0)"
    r = int(min(w, h) * ROUND_R + 0.5)
    dx, dy = f"max(abs(X-{w / 2})-{w / 2 - r},0)", f"max(abs(Y-{h / 2})-{h / 2 - r},0)"
    return f"if(lte(hypot({dx},{dy}),{r}),255,0)"


def _gaming(F: str, W: int, H: int, edit: dict, src_w: int, src_h: int) -> str:
    """Facecam top/bottom, PiP, gameplay only, reaction stack: each region's crop, scaled into place (clips/gaming.py)."""
    rs = regions(edit["layoutId"], {"facecam": edit.get("facecam"), "game": edit.get("game"), "pip": edit.get("pip")}, src_w, src_h, W, H)
    parts = [f"[0:v]fps={F},split={len(rs)}" + "".join(f"[g{i}]" for i in range(len(rs))) if len(rs) > 1 else f"[0:v]fps={F}[g0]"]
    for i, r in enumerate(rs):
        (sx, sy, sw, sh), (dx, dy, dw, dh) = r["src"], r["dst"]
        chain = f"[g{i}]crop={sw}:{sh}:{sx}:{sy},scale={dw}:{dh},setsar=1"
        if r["shape"] != "rect":
            chain += f",format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{_mask(r['shape'], dw, dh)}'"
        parts.append(chain + f"[p{i}]")
    cur = "p0"
    if rs[0]["dst"] != [0, 0, W, H]:
        parts.append(f"[p0]pad={W}:{H}:{rs[0]['dst'][0]}:{rs[0]['dst'][1]}:black[b0]")
        cur = "b0"
    for i, r in enumerate(rs[1:], 1):
        parts.append(f"[{cur}][p{i}]overlay={r['dst'][0]}:{r['dst'][1]}:format=auto[b{i}]")
        cur = f"b{i}"
    parts.append(f"[{cur}]format=yuv420p,setsar=1[v0]")
    return ";".join(parts)


def build_command(src: Path, out_name: str, edit: dict, keyframes, src_w: int, src_h: int, start: float, end: float,
                  logo: Path | None, ass_name: str, encoder: str, keep=None, zooms=(), fps: float = 30.0, has_audio: bool = True,
                  bumpers=(), rows: dict | None = None, wide=()) -> list[str]:
    """Run with cwd = the renders folder: ass_name and '.fonts' are relative there, so no path needs filtergraph escaping.
    keep / zooms: clip-relative seconds (the cut list and punch-ins the editor saved). bumpers: [(path, has_audio, duration)]
    for the intro and outro, in order around the clip. Crop and zoom run on the uncut clock; the cuts come after them."""
    W, H = output_size(edit["aspect"], edit["resolution"])
    dur = end - start
    F = _fmt(fps)
    video = _rows(F, W, H, edit, keyframes, rows, start, dur, src_w, src_h) if rows and edit["layoutId"] in ("split", "grid") else None
    if edit["layoutId"] in GAMING_LAYOUTS:
        video = _gaming(F, W, H, edit, src_w, src_h)
    if not video and edit["layoutId"] == "wide-blur":
        video = (f"[0:v]fps={F},split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=20:2,eq=brightness=-0.12[bg];"
                 f"[b]scale={W}:{H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]")
    elif not video:  # single, active speaker (its own crop path), or split/grid with nobody else on screen in this clip
        a = ASPECT[edit["aspect"]]
        zoom = (f",zoompan=z='{zoom_expr(zooms)}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={W}x{H}:fps={F},setsar=1" if zooms else "")
        video = f"[0:v]fps={F},{_crop(keyframes, start, dur, src_w, src_h, a)},scale={W}:{H},setsar=1{zoom}[v0]"
    wide = in_clip(wide, start, dur) if edit["layoutId"] not in ("wide-blur", *GAMING_LAYOUTS) else []
    if wide:  # shots with no face found (people too small): the whole frame over a blurred fill, not a crop that cuts them off
        en = "+".join(f"between(t,{_fmt(a)},{_fmt(b)})" for a, b in wide)
        video = (f"[0:v]split[vin][wsrc];" + video.replace("[0:v]", "[vin]", 1)[: -len("[v0]")] + "[vcrop];"
                 f"[wsrc]fps={F},split[wa][wb];[wa]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=20:2,eq=brightness=-0.12[wbg];"
                 f"[wb]scale={W}:{H}:force_original_aspect_ratio=decrease[wfg];[wbg][wfg]overlay=(W-w)/2:(H-h)/2,setsar=1[wfull];"
                 f"[vcrop][wfull]overlay=0:0:enable='{en}'[v0]")
    parts = [video]
    # Cuts: one trim per kept part, joined. Cut points sit on the frame grid so sound and picture stay the same length.
    snap = lambda t: _fmt(round(t * fps) / fps)  # noqa: E731
    keep = [(a, b) for a, b in (keep or [(0.0, dur)]) if b - a > 1 / fps] or [(0.0, dur)]
    k = len(keep)
    AF = "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    parts.append(f"[v0]split={k}" + "".join(f"[s{i}]" for i in range(k)) if k > 1 else "[v0]null[s0]")
    if has_audio:
        parts.append(f"[0:a]{AF},asplit={k}" + "".join(f"[r{i}]" for i in range(k)) if k > 1 else f"[0:a]{AF}[r0]")
    pads = ""
    for i, (a, b) in enumerate(keep):
        parts.append(f"[s{i}]trim=start={snap(a)}:end={snap(b)},setpts=PTS-STARTPTS[t{i}]")
        pads += f"[t{i}]"
        if has_audio:
            parts.append(f"[r{i}]atrim=start={snap(a)}:end={snap(b)},asetpts=PTS-STARTPTS[u{i}]")
            pads += f"[u{i}]"
    parts.append(f"{pads}concat=n={k}:v=1:a={int(has_audio)}[vc]" + ("[ac]" if has_audio else ""))
    parts.append(f"[vc]subtitles=f={ass_name}:fontsdir=.fonts[v1]")
    inputs = ["-ss", _fmt(start), "-to", _fmt(end), "-i", str(src)]
    if logo:
        b = edit["brand"]
        lw = max(2, round(W * b["sizePct"] / 100) // 2 * 2)
        x, y = _logo_xy(b["position"], round(W * b["marginPct"] / 100))
        parts.append(f"[1:v]scale={lw}:-1,format=rgba,colorchannelmixer=aa={_fmt(b['opacity'] / 100)}[lg]")
        parts.append(f"[v1][lg]overlay=x={x}:y={y}:format=auto,format=yuv420p[vm]")
        inputs += ["-i", str(logo)]
    else:
        parts.append("[v1]format=yuv420p[vm]")
    vout, aout = "[vm]", ("[ac]" if has_audio else None)
    intro, outro = bumpers or (None, None)
    if intro or outro:
        seq = ""
        for name, bump in (("in", intro), ("clip", None), ("out", outro)):
            if name == "clip":
                seq += "[vm]" + ("[ac]" if has_audio else "")
                continue
            if not bump:
                continue
            path, b_audio, b_dur = bump
            idx = inputs.count("-i")
            inputs += ["-i", str(path)]
            parts.append(f"[{idx}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps={F},format=yuv420p[{name}v]")
            if has_audio:
                parts.append(f"[{idx}:a]{AF}[{name}a]" if b_audio else f"anullsrc=r=48000:cl=stereo,atrim=duration={_fmt(b_dur)},{AF}[{name}a]")
            seq += f"[{name}v]" + (f"[{name}a]" if has_audio else "")
        n = 1 + bool(intro) + bool(outro)
        parts.append(f"{seq}concat=n={n}:v=1:a={int(has_audio)}[vout]" + ("[aout]" if has_audio else ""))
        vout, aout = "[vout]", ("[aout]" if has_audio else None)
    enc = (["-c:v", "h264_videotoolbox", "-b:v", "8M" if edit["resolution"] == "1080p" else "5M", "-profile:v", "high"]
           if encoder == "h264_videotoolbox" else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"])
    return ["ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1", *inputs, "-filter_complex", ";".join(parts),
            "-map", vout, *(["-map", aout] if aout else []), *enc, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out_name]


def safe_filename(title: str, ext: str) -> str:
    """A download/ZIP name from a clip title: no path or shell-hostile characters, ≤ 80 chars."""
    s = re.sub(r'[/\\:*?"<>|\x00-\x1f]', " ", title or "")
    s = re.sub(r"\s+", " ", s).strip(" .")[:80].strip() or "clip"
    return f"{s}.{ext}"
