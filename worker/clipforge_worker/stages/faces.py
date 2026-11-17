"""Where is the face? MediaPipe face detection on the 480p proxy at 2 fps → faces.json, smoothed once per video → track.json.
Every clip, trim and aspect ratio reads track.json, so editing a trim never re-runs detection. ~150 MB, CPU only."""
import json
import logging
import os
import subprocess
import urllib.request

import numpy as np

from ..clips.reframe import faceless_shots, smooth_track
from ..errors import Cancelled
from ..media import probe

log = logging.getLogger("clipforge.worker")
FPS = 2
# The single-face crop needs sure faces (test patterns gave false ones at 0.50–0.56); small faces in wide two-person
# shots score 0.5–0.65, so the all-faces list (speaker layouts) takes them, and people.py keeps only faces that persist.
TRACK_MIN, ALL_MIN = 0.65, 0.5
WIDTH = 320  # detection size: plenty for faces in a podcast frame, cheap to decode
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"


def _model(data_dir) -> str:
    path = data_dir / "models" / "blaze_face_short_range.tflite"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        urllib.request.urlretrieve(MODEL_URL, tmp)  # ~230 KB, once
        os.replace(tmp, path)
    return str(path)


CUT_FPS, CUT_W, CUT_H = 25, 64, 36
CUT_DIFF = 12      # mean |Δ| of tiny grey frames: ordinary frames < 4, camera cuts 15–30 (catches cuts between flat frames)
CUT_DECORREL = 0.5  # 1 − correlation of consecutive frames' patterns: a new shot ~0.9+, motion within a shot < 0.3. Brightness-free,
#                     so cuts in a black-background studio (mean level 3/255, |Δ| ~8) are found; the old |Δ| test missed them
CUT_MIN_STD = 1.0  # flat (near-blank) frames have no pattern to compare
CUT_GAP_S = 0.5    # flashes and fades produce runs of big diffs: keep the first


def _decorrelation(a: np.ndarray, b: np.ndarray) -> float:
    za, zb = a - a.mean(), b - b.mean()
    sa, sb = float(np.sqrt((za ** 2).mean())), float(np.sqrt((zb ** 2).mean()))
    if max(sa, sb) < CUT_MIN_STD:
        return 0.0
    return 1.0 - float((za * zb).mean()) / max(sa * sb, 1e-6)


def _is_cut(a: np.ndarray, b: np.ndarray) -> bool:
    """Frames with a picture: their patterns stop matching (fast motion keeps them matching; a brightness test doesn't —
    it fired 220 times on 10 minutes of gameplay). Near-blank frames have no pattern: a big level change, then."""
    if max(a.std(), b.std()) < CUT_MIN_STD:
        return float(np.abs(a - b).mean()) > CUT_DIFF
    return _decorrelation(a, b) > CUT_DECORREL


def find_cuts(proxy) -> list[float]:
    """Camera-cut times, frame-accurate at 25 fps (a cheap pass over 64×36 grey frames)."""
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(proxy), "-vf", f"fps={CUT_FPS},scale={CUT_W}:{CUT_H},format=gray",
                             "-f", "rawvideo", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    cuts, prev, n, size = [], None, 0, CUT_W * CUT_H
    try:
        while (buf := proc.stdout.read(size)) and len(buf) == size:
            f = np.frombuffer(buf, np.uint8).astype(np.float32)
            if prev is not None and _is_cut(f, prev):
                t = n / CUT_FPS
                if not cuts or t - cuts[-1] >= CUT_GAP_S:
                    cuts.append(round(t, 3))
            prev, n = f, n + 1
    finally:
        proc.stdout.close()
        proc.wait()
    return cuts


def _write(path, data) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    os.replace(tmp, path)


def run(ctx) -> None:
    """Never fails the job: without a track the crop stays centred, and the next Find clips/export tries again."""
    if (ctx.media_dir / "track.json").exists():
        ctx.report(1.0)
        return
    try:
        _detect(ctx)
    except Cancelled:
        raise
    except Exception as e:  # offline on first use (model download), missing proxy, MediaPipe error…
        log.warning("face tracking skipped: %s", e)
        ctx.report(1.0)


def _detect(ctx) -> None:
    md = ctx.media_dir
    import mediapipe as mp  # imported here: only this stage pays for it
    from mediapipe.tasks.python import BaseOptions, vision

    proxy = md / "proxy.mp4"
    v = probe(proxy)
    w, h = WIDTH, max(2, round(WIDTH * v["height"] / v["width"] / 2) * 2)
    total = max(1, int(float(ctx.project.get("durationSec") or 0) * FPS))
    detector = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=_model(ctx.data_dir)), min_detection_confidence=ALL_MIN))
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(proxy), "-vf", f"fps={FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frames, every, size = [], [], w * h * 3  # every: all faces per frame (speaker layouts need more than the biggest)
    try:
        while (buf := proc.stdout.read(size)) and len(buf) == size:
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.frombuffer(buf, np.uint8).reshape(h, w, 3))
            found = detector.detect(img).detections
            dets = [d for d in found if d.categories[0].score >= TRACK_MIN]
            every.append([[round((d.bounding_box.origin_x + d.bounding_box.width / 2) / w, 4), round((d.bounding_box.origin_y + d.bounding_box.height / 2) / h, 4),
                           round(d.bounding_box.width / w, 4), round(d.bounding_box.height / h, 4)] for d in found[:6]])
            if dets:
                b = max(dets, key=lambda d: d.bounding_box.width * d.bounding_box.height).bounding_box
                frames.append([round((b.origin_x + b.width / 2) / w, 4), round((b.origin_y + b.height / 2) / h, 4),
                               round(b.width / w, 4), round(b.height / h, 4), round(dets[0].categories[0].score, 3)])
            else:
                frames.append(None)
            if len(frames) % 20 == 0:
                ctx.report(min(0.99, len(frames) / total), "Finding faces")
    finally:
        proc.stdout.close()
        proc.wait()
        detector.close()
    ctx.report(0.99, "Finding camera cuts")
    cuts = find_cuts(proxy)
    _write(md / "faces.json", {"fps": FPS, "w": v["width"], "h": v["height"], "frames": frames, "all": every, "cuts": cuts})
    _write(md / "track.json", {"keyframes": smooth_track(frames, FPS, cuts), "wide": faceless_shots(frames, FPS, cuts)})  # sure faces only
    ctx.report(1.0)
