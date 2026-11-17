"""Face positions → a calm crop path. The crop holds still through jitter and short dropouts and pans only when the
speaker really moves. center_at / crop_rect are mirrored in web/lib/reframe.ts (same test numbers) for the live preview."""
import math

# Calm on purpose: people sway and lean while they talk (±0.06 of the frame); a crop that follows every lean reads as
# a restless camera (measured: one pan every 3 s with the old 0.04 / 0.5 s / 1 s). Pans now happen only for real moves.
DEAD_ZONE = 0.08      # of source width/height: smaller moves never pan
SETTLE_S = 1.0        # the face must stay outside the dead-zone this long before we pan
MIN_GAP_S = 3.0       # between pans
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
    cuts = sorted(cuts)
    fx, fy = OneEuro(fps), OneEuro(fps)
    held = (known[0][0], known[0][1])  # leading gaps take the first face
    keys = [(0.0, *held)]
    outside, last_move, shot_face = 0, -MIN_GAP_S, held  # gaps inside a shot hold that shot's last face
    for n, f in enumerate(frames):
        t = n / fps
        cut = next((c for c in cuts if (n - 1) / fps < c <= t), None)
        if cut is not None:  # new shot: jump (no pan) and restart the filters there
            nxt = next((c for c in cuts if c > cut), math.inf)
            first = next((frames[i] for i in range(n, len(frames)) if i / fps < nxt and frames[i]), None)
            shot_face = (first[0], first[1]) if first else None
            target = shot_face or (0.5, 0.5)  # no face anywhere in this shot (a wide shot): centre
            if target != held:
                keys += [(cut, *held), (cut + JUMP_S, *target)]
            fx, fy = OneEuro(fps), OneEuro(fps)
            held, last_move, outside = target, cut, 0
        if f:
            shot_face = (f[0], f[1])
        if shot_face is None:
            continue
        x, y = shot_face
        sx, sy = fx(x), fy(y)
        if max(abs(sx - held[0]), abs(sy - held[1])) <= DEAD_ZONE:
            outside = 0
            continue
        outside += 1
        if outside / fps >= SETTLE_S and t - last_move >= MIN_GAP_S:
            keys += [(t, *held), (t + PAN_S, sx, sy)]
            held, last_move, outside = (sx, sy), t + PAN_S, 0
    return [(round(t, 3), round(x, 4), round(y, 4)) for t, x, y in keys]


def faceless_shots(every: list, fps: float, cuts, min_s: float = 0.4) -> list[list[float]]:
    """Shots (between camera cuts) in which no face was found at all — usually a wide shot whose people are too small to
    detect. A crop of one would cut people off, so the export and the editor show the whole frame over a blurred fill there.
    every: per frame, the face(s) found or something falsy (faces.json "frames": the sure ones)."""
    end = len(every) / fps
    b = [0.0, *sorted(c for c in cuts if 0 < c < end), end]
    out: list[list[float]] = []
    for s, e in zip(b, b[1:]):
        frames = every[math.ceil(s * fps - 1e-9): math.ceil(e * fps - 1e-9)]
        if frames and not any(frames):
            if out and abs(out[-1][1] - s) < 1e-6:
                out[-1][1] = e  # back-to-back faceless shots: one range
            else:
                out.append([s, e])
    return [[round(s, 3), round(e, 3)] for s, e in out if e - s >= min_s]


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
