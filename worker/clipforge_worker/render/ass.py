"""Subtitle style + words → ASS (libass). Line-by-line port of web/lib/ass.ts: the editor preview (JASSUB) and this export
draw the same text. shared/ass-fixtures keeps the two byte-identical — change both together and run `npm run ass:fixtures`."""
import json
import math
import re
from pathlib import Path

FONTS_DIR = Path(__file__).resolve().parents[3] / "web" / "public" / "fonts"
FONTS = json.loads((FONTS_DIR / "fonts.json").read_text())
FALLBACK_FONT = "Noto Sans Devanagari"
SUB_TOP = {"top": 15, "middle": 50, "bottom": 72}
ALIGN = {"tl": 7, "tc": 8, "tr": 9, "ml": 4, "c": 5, "mr": 6, "bl": 1, "bc": 2, "br": 3}
DEVANAGARI = re.compile("[ऀ-ॿ]")


def _round(n: float) -> int:  # JS Math.floor(n + 0.5): half-up, unlike Python's banker's round()
    return math.floor(n + 0.5)


def _num(n: float) -> str:  # JS String(Math.round(n*100)/100)
    v = _round(n * 100) / 100
    return str(int(v)) if v == int(v) else repr(v)


def _bgr(h: str) -> str:
    return (h[5:7] + h[3:5] + h[1:3]).upper()


def _colour(h: str, alpha: int = 0) -> str:
    return f"&H{alpha:02X}{_bgr(h)}"


def _alpha(opacity_pct: float) -> int:
    return _round(255 * (1 - opacity_pct / 100))


def _tag(h: str) -> str:
    return f"&H{_bgr(h)}&"


def time(t: float) -> str:
    cs = _round(max(0, t) * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def font_for(family: str, weight: int) -> tuple[str, bool]:
    """Nearest bundled weight of a family (tie → heavier); unknown family → Inter."""
    c = [f for f in FONTS if f["family"] == family] or [f for f in FONTS if f["family"] == "Inter"]
    best = c[0]
    for b in c[1:]:
        da, db = abs(best["weight"] - weight), abs(b["weight"] - weight)
        if db < da or (db == da and b["weight"] > best["weight"]):
            best = b
    return best["assName"], best["bold"]


def _clean(w: str, case: str) -> str:
    w = w.upper() if case == "upper" else w.lower() if case == "lower" else w
    return w.replace("{", "(").replace("}", ")").replace("\\", "/")


def _style_line(name, font, size, primary, secondary, outline, back, border_style, outline_w, shadow, align, ml, mr, mv) -> str:
    return (f"Style: {name},{font[0]},{_num(size)},{primary},{secondary},{outline},{back},{-1 if font[1] else 0},0,0,0,100,100,0,0,"
            f"{border_style},{_num(outline_w)},{_num(shadow)},{align},{ml},{mr},{mv},1")


def build_ass(i: dict) -> str:
    st, W, H = i["style"], i["width"], i["height"]
    words = [{**w, "w": _clean(w["w"], st["case"])} for w in i["words"]]
    font = font_for(FALLBACK_FONT if any(DEVANAGARI.search(w["w"]) for w in words) else st["font"], st["weight"])
    box = st.get("box")
    margin = _round(W * 0.05)
    if box:
        bc = _colour(box["color"], _alpha(box["opacity"]))
        styles = [_style_line("Default", font, st["sizePx"], _colour(st["color"]), _colour(st["activeColor"]), bc, bc, 4, box["padding"], 0, 5, margin, margin, 0)]
    else:
        back = _colour((st.get("shadow") or {}).get("color", "#000000"))
        styles = [_style_line("Default", font, st["sizePx"], _colour(st["color"]), _colour(st["activeColor"]), _colour(st["stroke"]["color"]), back,
                              1, st["stroke"]["width"], 0, 5, margin, margin, 0)]
    wm = i.get("watermarkText")
    if wm and wm.get("value"):
        m = _round(W * wm["marginPct"] / 100)
        styles.append(_style_line("Watermark", font_for(wm["font"], 600), _round(W * max(2.5, wm["sizePct"] / 3) / 100),
                                  _colour(wm["color"], _alpha(wm["opacity"])), _colour(wm["color"]), _colour("#000000", 0x80), _colour("#000000", 0x80),
                                  1, 0, 2, ALIGN[wm["position"]], m, m, m))
    hook = i.get("hook") if i.get("hook") and i["hook"]["text"].strip() else None
    if hook:  # the AI hook line: dark text on a white box over the first seconds
        u = min(W, H)
        styles.append(_style_line("Hook", font_for(FALLBACK_FONT if DEVANAGARI.search(hook["text"]) else st["font"], 800), _round(u * 0.065),
                                  _colour("#111113"), _colour("#111113"), _colour("#FFFFFF"), _colour("#FFFFFF"), 4, _round(u * 0.02), 0, 5,
                                  _round(W * 0.1), _round(W * 0.1), 0))

    x = _round(W / 2)
    y = _round(H * min(95, max(5, SUB_TOP[st["position"]] + st["offsetPct"])) / 100)
    fx = ""
    sh = st.get("shadow")
    if sh:
        if sh["x"] or sh["y"]:
            fx += f"\\xshad{_num(sh['x'])}\\yshad{_num(sh['y'])}"
        if sh["blur"]:
            fx += f"\\blur{_num(sh['blur'] / 4)}"
    primary, active = _tag(st["color"]), _tag(st["activeColor"])
    sc = i.get("speakerColors") or None

    def base(w: dict) -> str:
        return _tag(sc[w["sp"] % len(sc)]) if sc and "sp" in w else primary

    def plain(w: dict) -> str:
        return f"{{\\1c{base(w)}}}{w['w']}" if sc else w["w"]
    per = st["wordsPerLine"] * st["lines"]
    events: list[str] = []

    def join(ws: list[str]) -> str:
        return "".join(("" if k == 0 else "\\N" if st["lines"] == 2 and k == st["wordsPerLine"] else " ") + w for k, w in enumerate(ws))

    def ev(a: float, b: float, tags: str, text: str) -> None:
        events.append(f"Dialogue: 0,{time(a)},{time(min(b, i['duration']))},Default,,0,0,0,,{{{tags}}}{text}")

    anim = st["animation"]
    for c in range(0, len(words), per):
        chunk, nxt = words[c:c + per], (words[c + per] if c + per < len(words) else None)
        last = chunk[-1]
        hold = nxt["s"] if nxt and nxt["s"] - last["e"] < 0.5 else last["e"]
        m = next((r for r in i.get("middle") or [] if r[0] <= chunk[0]["s"] < r[1]), None)
        cy = _round(H * m[2] / 100) if m else y
        pos = f"\\pos({x},{cy})"
        if anim in ("fade", "none"):
            ev(chunk[0]["s"], hold, pos + fx + ("\\fad(120,120)" if anim == "fade" else ""), join([plain(w) for w in chunk]))
            continue
        for k, w in enumerate(chunk):
            end = chunk[k + 1]["s"] if k < len(chunk) - 1 else hold
            shown = chunk[:k + 1] if anim == "typewriter" else chunk
            parts = []
            for j, sw in enumerate(shown):
                if j != k:
                    parts.append(plain(sw))
                elif anim == "pop":
                    parts.append(f"{{\\1c{active}\\t(0,80,\\fscx118\\fscy118)\\t(80,160,\\fscx108\\fscy108)}}{sw['w']}{{\\1c{base(sw)}\\fscx100\\fscy100}}")
                else:
                    parts.append(f"{{\\1c{active}}}{sw['w']}{{\\1c{base(sw)}}}")
            at = f"\\move({x},{cy + _round(H * 0.02)},{x},{cy},0,150)" if anim == "slide" and k == 0 else pos
            ev(w["s"], end, at + fx, join(parts))
    if wm and wm.get("value"):
        events.append(f"Dialogue: 1,{time(0)},{time(i['duration'])},Watermark,,0,0,0,,{_clean(wm['value'], 'none')}")
    if hook:
        hy = _round(H * (34 if st["position"] == "top" else 22) / 100)  # clear of top-placed subtitles
        events.append(f"Dialogue: 2,{time(0)},{time(min(hook['end'], i['duration']))},Hook,,0,0,0,,{{\\pos({x},{hy})\\fad(150,200)}}{_clean(hook['text'].strip(), 'none')}")

    return "\n".join([
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "YCbCr Matrix: None", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        *styles, "",
        "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *events, "",
    ])
