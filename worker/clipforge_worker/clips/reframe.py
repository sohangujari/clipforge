"""Face positions → a calm crop path. The crop holds still through jitter and short dropouts and pans only when the
speaker really moves. center_at / crop_rect are mirrored in web/lib/reframe.ts (same test numbers) for the live preview."""
import math

DEAD_ZONE = 0.04      # of source width/height: smaller moves never pan
SETTLE_S = 0.5        # the face must stay outside the dead-zone this long before we pan
MIN_GAP_S = 1.0       # between pans
PAN_S = 0.4           # a pan's length
MIN_CUTOFF, BETA = 0.3, 0.02  # One-Euro filter
JUMP_S = 0.001        # a camera cut: the crop jumps (no pan) to the new shot's face


class OneEuro:
    def __init__(self, rate: float):
        self.rate, self.x, self.dx = rate, None, 0.0

    @staticmethod
    def _alpha(cutoff: float, rate: float) -> float:
        tau = 1 / (2 * math.pi * cutoff)
        return 1 / (1 + tau * rate)

    def __call__(self, v: float) -> float:
        if self.x is None:
            self.x = v
            return v
        dx = (v - self.x) * self.rate
        self.dx += self._alpha(1.0, self.rate) * (dx - self.dx)
        self.x += self._alpha(MIN_CUTOFF + BETA * abs(self.dx), self.rate) * (v - self.x)
        return self.x


def smooth_track(frames: list, fps: float, cuts=()) -> list[tuple[float, float, float]]:
    """frames: [cx, cy, w, h, score] or None per sample (normalised); cuts: camera-cut times (s). Returns keyframes [(t, cx, cy)],
    first at t=0. Within a shot the crop holds and pans gently; at a cut it jumps straight to the new shot's face."""
    known = [f for f in frames if f]
    if not known:
        return [(0.0, 0.5, 0.5)]
    last, pts = known[0], []  # leading gaps take the first face; later gaps hold the last one
    for f in frames:
        last = f or last
        pts.append((last[0], last[1]))
    fx, fy = OneEuro(fps), OneEuro(fps)
    held = pts[0]
    keys = [(0.0, *held)]
    outside, last_move = 0, -MIN_GAP_S
    cuts = sorted(cuts)
    for n, (x, y) in enumerate(pts):
        t = n / fps
        cut = next((c for c in cuts if (n - 1) / fps < c <= t), None)
        if cut is not None and frames[n]:  # new shot with a face: jump, and restart the filters there
            if (x, y) != held:
                keys += [(cut, *held), (cut + JUMP_S, x, y)]
            fx, fy = OneEuro(fps), OneEuro(fps)
            held, last_move, outside = (x, y), cut, 0
        sx, sy = fx(x), fy(y)
        if max(abs(sx - held[0]), abs(sy - held[1])) <= DEAD_ZONE:
            outside = 0
            continue
        outside += 1
        if outside / fps >= SETTLE_S and t - last_move >= MIN_GAP_S:
            keys += [(t, *held), (t + PAN_S, sx, sy)]
            held, last_move, outside = (sx, sy), t + PAN_S, 0
    return [(round(t, 3), round(x, 4), round(y, 4)) for t, x, y in keys]


def center_at(keyframes, t: float) -> tuple[float, float]:
    if t <= keyframes[0][0]:
        return keyframes[0][1], keyframes[0][2]
    for (t0, x0, y0), (t1, x1, y1) in zip(keyframes, keyframes[1:]):
        if t <= t1:
            a = (t - t0) / (t1 - t0) if t1 > t0 else 1
            return x0 + (x1 - x0) * a, y0 + (y1 - y0) * a
    return keyframes[-1][1], keyframes[-1][2]


def crop_rect(cx: float, cy: float, src_w: int, src_h: int, out_aspect: float, scale: float = 1.0) -> tuple[int, int, int, int]:
    """Largest out_aspect rect inside the source (times scale: tighter crops for one person of several), centred on
    (cx, cy), clamped to the frame; all values even."""
    if src_w / src_h > out_aspect:
        w, h = src_h * out_aspect, src_h
    else:
        w, h = src_w, src_w / out_aspect
    w, h = w * scale, h * scale
    w, h = int(w) // 2 * 2, int(h) // 2 * 2
    x = min(max(math.floor(cx * src_w - w / 2 + 0.5), 0), src_w - w) // 2 * 2
    y = min(max(math.floor(cy * src_h - h / 2 + 0.5), 0), src_h - h) // 2 * 2
    return x, y, w, h


FACE_TO_CROP = 3.2  # split/grid rows: a person's crop is this many face-heights tall


def row_scale(face_h, src_w: int, src_h: int, aspect: float) -> float:
    """crop_rect scale for one person's row: tight enough that the neighbour isn't in it. face_h: share of frame height."""
    if not face_h:
        return 1.0
    full_h = src_h if src_w / src_h > aspect else src_w / aspect
    return min(1.0, round(FACE_TO_CROP * face_h * src_h / full_h, 4))
