"""Retiming and zoom for cut clips — a port of web/lib/cuts.ts (the editor decides the cuts and zooms; the export follows).
shared/cuts-fixture.json keeps both identical."""
import math

ZOOM, ZOOM_IN, ZOOM_OUT = 1.12, 0.12, 0.3
MIN_HEARD = 0.05


def _r3(n: float) -> float:
    return math.floor(n * 1000 + 0.5) / 1000  # JS Math.round: half-up


def to_out(keep, t: float) -> float:
    o = 0.0
    for a, b in keep:
        if t < a:
            return o
        if t <= b:
            return o + t - a
        o += b - a
    return o


def kept_duration(keep) -> float:
    return _r3(sum(b - a for a, b in keep))


def retime_words(words: list, keep) -> list:
    out = []
    for w in words:
        s, e = _r3(to_out(keep, w["s"])), _r3(to_out(keep, w["e"]))
        if e - s >= MIN_HEARD:
            out.append({"w": w["w"], "s": s, "e": e, **({"sp": w["speaker"]} if "speaker" in w else {})})
    return out


def zoom_at(zooms, t: float) -> float:
    z = sum(min(1, max(0, (t - a) / ZOOM_IN)) * min(1, max(0, (b - t) / ZOOM_OUT)) for a, b in zooms)
    return 1 + (ZOOM - 1) * z


def zoom_expr(zooms, var: str = "it") -> str:
    """zoom_at as an FFmpeg expression of var (zoompan's input time). zooms are already relative to the clip start."""
    f = lambda n: f"{n:.3f}".rstrip("0").rstrip(".")  # noqa: E731
    terms = "+".join(f"clip(({var}-{f(a)})/{ZOOM_IN},0,1)*clip(({f(b)}-{var})/{ZOOM_OUT},0,1)" for a, b in zooms)
    return f"1+{f(ZOOM - 1)}*({terms})" if terms else "1"


def middle_ranges(ranges, keep, vertical: bool) -> list:
    """web/lib/cuts.ts middleRanges: where subtitles sit on the split/grid divider, on the cut clip's clock."""
    if not vertical:
        return []
    out = [[_r3(to_out(keep, a)), _r3(to_out(keep, b)), 50 if k == 2 else 66.67] for a, b, k, *_ in ranges]
    return [r for r in out if r[1] > r[0]]
