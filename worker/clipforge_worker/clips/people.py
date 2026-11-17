"""Who is on screen in each shot, which voice is whose face, and the crop paths for the speaker layouts.
Pure functions (stages/speakers.py does the I/O). The editor preview and the export both read the result
(media/<id>/people.json), so none of this is mirrored in TypeScript."""
import math
from bisect import bisect_right
from statistics import mean, median

from .reframe import JUMP_S, center_at, smooth_track

GROUP_GAP = 0.12      # faces further apart than this (share of frame width) are different people
MIN_PRESENCE = 0.4    # a person must be in this share of a shot's frames (drops passers-by and false faces)
MAX_PEOPLE = 3
MIN_SHOT_S = 1.5      # active speaker: never cut away sooner than this
SWITCH_AFTER_S = 1.0  # …and only once the new voice has gone on this long (a 0.6 s "mm-hm" must not cut)
MIN_EVIDENCE_S = 2.0  # speech needed in a shot to tie a voice to a face by mouth movement
MOUTH_FPS = 8


class Speech:
    """Diarized segments [(start, end, speaker)] → who speaks at time t."""

    def __init__(self, segments):
        self.segs = sorted(segments)
        self.starts = [s for s, _, _ in self.segs]

    def at(self, t: float):
        i = bisect_right(self.starts, t) - 1
        while i >= 0 and self.segs[i][0] > t - 30:  # segments can overlap; the latest one still running wins
            s, e, spk = self.segs[i]
            if s <= t < e:
                return spk
            i -= 1
        return None

    def seconds(self, spk, a: float, b: float) -> float:
        return sum(max(0.0, min(e, b) - max(s, a)) for s, e, sp in self.segs if sp == spk)


def renumber(segments, min_total_s: float = 3.0):
    """Speakers 0, 1, 2… by talk time; voices with under min_total_s of speech (noise, one-off clusters) are dropped."""
    total: dict = {}
    for s, e, spk in segments:
        total[spk] = total.get(spk, 0.0) + e - s
    order = [spk for spk, t in sorted(total.items(), key=lambda kv: -kv[1]) if t >= min_total_s]
    new = {spk: i for i, spk in enumerate(order)}
    return [(round(s, 3), round(e, 3), new[spk]) for s, e, spk in segments if spk in new]


def label_words(words: list, speech: Speech) -> None:
    """Gives each word the speaker who talks most during it (in place)."""
    for w in words:
        best, most = None, 0.0
        for s, e, spk in speech.segs[max(0, bisect_right(speech.starts, w["s"]) - 8): bisect_right(speech.starts, w["e"])]:
            o = min(e, w["e"]) - max(s, w["s"])
            if o > most:
                best, most = spk, o
        if best is not None:
            w["speaker"] = best
        else:
            w.pop("speaker", None)


def shots(duration: float, cuts) -> list[tuple[float, float]]:
    b = [0.0, *sorted(c for c in cuts if 0 < c < duration), duration]
    return [(x, y) for x, y in zip(b, b[1:]) if y - x > 0.05]


def shot_people(every: list, fps: float, s: float, e: float) -> list[dict]:
    """People in the shot, left to right: {x, frames (box or None per frame), count}. every = faces.json "all"."""
    i0, i1 = math.ceil(s * fps - 1e-9), min(len(every), math.ceil(e * fps - 1e-9))
    n = i1 - i0
    if n <= 0:
        return []
    groups: list[list[float]] = []
    for x in sorted(f[0] for i in range(i0, i1) for f in every[i]):
        if groups and x - groups[-1][-1] <= GROUP_GAP:
            groups[-1].append(x)
        else:
            groups.append([x])
    people = []
    for c in (median(g) for g in groups):
        frames = []
        for i in range(i0, i1):
            near = [f for f in every[i] if abs(f[0] - c) <= GROUP_GAP]
            frames.append([*min(near, key=lambda f: abs(f[0] - c))[:4], 1.0] if near else None)
        count = sum(1 for f in frames if f)
        if count >= MIN_PRESENCE * n:
            people.append({"x": c, "frames": frames, "count": count})
    return sorted(sorted(people, key=lambda p: -p["count"])[:MAX_PEOPLE], key=lambda p: p["x"])


def map_voices(people: list, mouth: list, speech: Speech) -> dict:
    """{person index: speaker}. mouth = [(t, [(cx, jawOpen), …])] at MOUTH_FPS. Each voice goes to the face whose mouth
    moves most while it is heard (greedy, one voice per face); too little speech in the shot → no match."""
    acts: dict = {}
    prev: dict = {}
    for t, faces in mouth:
        spk = speech.at(t)
        seen = {}
        for cx, jaw in faces:
            k = min(range(len(people)), key=lambda j: abs(people[j]["x"] - cx), default=None)
            if k is not None and abs(people[k]["x"] - cx) <= GROUP_GAP:
                seen[k] = jaw
        for k, jaw in seen.items():
            if k in prev and spk is not None:
                acts.setdefault(spk, {}).setdefault(k, []).append(abs(jaw - prev[k]))
        prev = seen
    pairs = sorted(((mean(v), spk, k) for spk, d in acts.items() for k, v in d.items() if len(v) >= MIN_EVIDENCE_S * MOUTH_FPS),
                   key=lambda p: -p[0])
    out: dict = {}
    for _, spk, k in pairs:
        if k not in out and spk not in out.values():
            out[k] = spk
    return out


def _span(kf, a: float, b: float) -> list:
    """kf's path from a to b, ending just before b so the next part can jump."""
    end = max(a, b - JUMP_S)
    return [(a, *center_at(kf, a)), *[k for k in kf if a < k[0] < end], (end, *center_at(kf, end))]


def _round(keys) -> list:
    out = []
    for t, x, y in keys:
        if not out or t > out[-1][0]:
            out.append([round(t, 3), round(x, 4), round(y, 4)])
    return out


def build(duration: float, cuts, every: list, fps: float, speech: Speech, mouth_for, fallback_kf) -> dict:
    """Everything the speaker layouts need. mouth_for(s, e) runs the landmarker on a shot with 2+ people.
    fallback_kf: the plain face track (shots with nobody found)."""
    plan_shots = []
    for s, e in shots(duration, cuts):
        people = shot_people(every, fps, s, e)
        for p in people:
            p["kf"] = [(s + t, x, y) for t, x, y in smooth_track(p["frames"], fps)]
            p["h"] = median(f[3] for f in p["frames"] if f)
            p["speaker"] = None
        if len(people) >= 2:
            for k, spk in map_voices(people, mouth_for(s, e), speech).items():
                people[k]["speaker"] = spk
        for p in people:
            p["talk"] = speech.seconds(p["speaker"], s, e) if p["speaker"] is not None else 0.0
        plan_shots.append((s, e, people))

    # Active speaker: one crop that cuts to whoever talks (in shots with one person: that person).
    track = []
    for s, e, people in plan_shots:
        if len(people) < 2:
            track += _span(people[0]["kf"] if people else fallback_kf, s, e)
            continue
        want = lambda t: next((j for j, p in enumerate(people) if p["speaker"] is not None and p["speaker"] == speech.at(t)), None)  # noqa: E731
        cur = want(s)
        if cur is None:
            cur = max(range(len(people)), key=lambda j: (people[j]["talk"], people[j]["count"]))
        start, last, pending, since, t = s, s, None, s, s
        while t < e:
            w = want(t)
            if w is not None and w != cur:
                if pending != w:
                    pending, since = w, t
                if t - since >= SWITCH_AFTER_S and t - last >= MIN_SHOT_S:
                    track += _span(people[cur]["kf"], start, t)
                    start, last, cur, pending = t, t, w, None
            else:
                pending = None
            t = round(t + 0.1, 3)
        track += _span(people[cur]["kf"], start, e)

    multi = [(s, e, p) for s, e, p in plan_shots if len(p) >= 2]
    plans = {}
    for name, rows in (("split", 2), ("grid", 3)):
        ranges, tracks, active = [], {}, []
        for s, e, people in multi:
            chosen = sorted(sorted(people, key=lambda p: (-p["talk"], -p["count"]))[:rows], key=lambda p: p["x"])
            k = len(chosen)
            ranges.append([round(s, 3), round(e, 3), k])
            rows_kf = tracks.setdefault(str(k), [[] for _ in range(k)])
            for j, p in enumerate(chosen):
                rows_kf[j] += _span(p["kf"], s, e)
                if name == "grid" and p["speaker"] is not None:
                    active += [[round(max(a, s), 3), round(min(b, e), 3), k, j] for a, b, spk in speech.segs if spk == p["speaker"] and a < e and b > s]
        plans[name] = {"ranges": ranges, "tracks": {k: [_round(r) for r in v] for k, v in tracks.items()}, **({"active": sorted(active)} if name == "grid" else {})}
    return {"track": _round(track), "faceH": round(median(p["h"] for _, _, ps in multi for p in ps), 4) if multi else None,
            "multi": bool(multi), **plans}
