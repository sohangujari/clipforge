"""Gaming / stream layouts: where the facecam and the gameplay go in the output frame. A line-by-line port of
web/lib/gaming.ts (regions, cover); shared/cuts-fixture.json keeps the two identical."""
import math

from .reframe import crop_rect

GAMING_LAYOUTS = ("facecam-top", "facecam-bottom", "pip", "gameplay-only", "reaction-stack")
FACE_SHARE = {"facecam-top": 0.35, "facecam-bottom": 0.35, "reaction-stack": 0.5}
DEFAULT_PIP = {"x": 0.76, "y": 0.15, "size": 0.36, "shape": "circle"}
ROUND_R = 0.18


def _half(n: float) -> int:
    return math.floor(n + 0.5)


def _even(n: float) -> int:
    return _half(n) // 2 * 2


def cover(b: dict, src_w: int, src_h: int, aspect: float) -> list[int]:
    """The largest `aspect` rect inside the box, centred on it."""
    bw, bh = b["w"] * src_w, b["h"] * src_h
    fw, fh = (bh * aspect, bh) if bw / bh > aspect else (bw, bw / aspect)
    w, h = max(2, int(fw) // 2 * 2), max(2, int(fh) // 2 * 2)
    x = min(max(_half(b["x"] * src_w + (bw - w) / 2), 0), src_w - w) // 2 * 2
    y = min(max(_half(b["y"] * src_h + (bh - h) / 2), 0), src_h - h) // 2 * 2
    return [x, y, w, h]


def regions(layout: str, o: dict, src_w: int, src_h: int, W: int, H: int) -> list[dict]:
    """[{kind, src, dst, shape}], drawn in order. o = {facecam: box | None, game: [cx, cy], pip: {x, y, size, shape}}."""
    gx, gy = o.get("game") or (0.5, 0.5)

    def game(dst):
        return {"kind": "game", "src": list(crop_rect(gx, gy, src_w, src_h, dst[2] / dst[3])), "dst": dst, "shape": "rect"}

    def face(dst, shape="rect"):
        return {"kind": "face", "src": cover(o["facecam"], src_w, src_h, dst[2] / dst[3]), "dst": dst, "shape": shape}

    if layout == "gameplay-only" or not o.get("facecam"):
        return [game([0, 0, W, H])]
    if layout == "pip":
        p = {**DEFAULT_PIP, **(o.get("pip") or {})}
        bw = _even(W * p["size"])
        bh = bw if p["shape"] == "circle" else _even(bw * 0.75)
        bx, by = _even(min(max(p["x"] * W - bw / 2, 0), W - bw)), _even(min(max(p["y"] * H - bh / 2, 0), H - bh))
        return [game([0, 0, W, H]), face([bx, by, bw, bh], p["shape"])]
    fh = _even(H * FACE_SHARE[layout])
    if layout == "facecam-top":
        return [face([0, 0, W, fh]), game([0, fh, W, H - fh])]
    return [game([0, 0, W, H - fh]), face([0, H - fh, W, fh])]
