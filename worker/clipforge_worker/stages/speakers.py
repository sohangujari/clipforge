"""Who speaks when (voices, no account needed) and which face is whose → speakers on the transcript, and
media/<id>/people.json for the Active speaker / Split / Grid layouts (clips/people.py).
Voices: sherpa-onnx speaker diarization (pyannote segmentation 3.0 + NeMo TitaNet-small, ONNX, CPU, ≤ ~600 MB).
Faces: MediaPipe FaceLandmarker mouth movement, only in shots where 2+ people are on screen."""
import gc
import json
import logging
import os
import subprocess
import tarfile
import urllib.request
import wave

import numpy as np

from ..clips.people import MOUTH_FPS, Speech, build, label_words, renumber
from ..errors import Cancelled
from ..media import probe

log = logging.getLogger(__name__)
REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
SEGMENTATION = f"{REL}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMBEDDING = f"{REL}/speaker-recongition-models/nemo_en_titanet_small.onnx"  # sic: the release tag is misspelt upstream
LANDMARKER = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
THRESHOLD = 1.1   # clustering: lower splits one voice into many (0.5 gave 28 "speakers" for 2 people), measured on a podcast
THREADS = 3       # leave a core for the app
MOUTH_W = 480


def _fetch(url: str, path) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, path)


def _models(data_dir, report) -> dict:
    d = data_dir / "models"
    seg = d / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx"
    if not seg.exists():
        report(0.02, "Downloading the speaker models (once, ~50 MB)")
        _fetch(SEGMENTATION, d / "pyannote-segmentation-3-0.tar.bz2")
        with tarfile.open(d / "pyannote-segmentation-3-0.tar.bz2") as t:
            t.extractall(d, filter="data")  # "data": no absolute paths, links or ../ escapes
        (d / "pyannote-segmentation-3-0.tar.bz2").unlink()
    emb, lm = d / "nemo_en_titanet_small.onnx", d / "face_landmarker.task"
    _fetch(EMBEDDING, emb)
    _fetch(LANDMARKER, lm)
    return {"segmentation": seg, "embedding": emb, "landmarker": lm}


def diarize(wav, m: dict, report) -> list:
    import sherpa_onnx as so
    cfg = so.OfflineSpeakerDiarizationConfig(
        segmentation=so.OfflineSpeakerSegmentationModelConfig(
            pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(m["segmentation"])), num_threads=THREADS),
        embedding=so.SpeakerEmbeddingExtractorConfig(model=str(m["embedding"]), num_threads=THREADS),
        clustering=so.FastClusteringConfig(num_clusters=-1, threshold=THRESHOLD), min_duration_on=0.3, min_duration_off=0.5)
    sd = so.OfflineSpeakerDiarization(cfg)
    with wave.open(str(wav)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768  # ponytail: whole file; chunk for 3 h+ streams
    cancelled = []

    def progress(done: int, total: int) -> int:  # runs inside the C++ library: must not raise
        try:
            report(0.05 + 0.6 * done / max(1, total))
        except Cancelled:
            cancelled.append(True)
            return 1  # asks sherpa-onnx to stop early
        return 0
    try:
        segs = sd.process(x, callback=progress).sort_by_start_time()
        if cancelled:
            raise Cancelled()
        return [(s.start, s.end, s.speaker) for s in segs]
    finally:
        del sd, x
        gc.collect()


def _mouth_reader(ctx, model):
    """mouth_for(s, e): jawOpen per face at MOUTH_FPS for one shot of the proxy."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision
    v = probe(ctx.media_dir / "proxy.mp4")
    w, h = MOUTH_W, max(2, round(MOUTH_W * v["height"] / v["width"] / 2) * 2)
    lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model)), num_faces=4, output_face_blendshapes=True,
        running_mode=vision.RunningMode.VIDEO, min_face_detection_confidence=0.5))
    last = [-1]

    def mouth_for(s: float, e: float) -> list:
        out = []
        proc = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{s:.3f}", "-t", f"{e - s:.3f}", "-i", str(ctx.media_dir / "proxy.mp4"),
                                 "-vf", f"fps={MOUTH_FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            n = 0
            while (buf := proc.stdout.read(w * h * 3)) and len(buf) == w * h * 3:
                t = s + n / MOUTH_FPS
                ms = max(last[0] + 1, int(t * 1000))  # VIDEO mode needs rising timestamps
                last[0] = ms
                r = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.frombuffer(buf, np.uint8).reshape(h, w, 3)), ms)
                out.append((t, [(sum(p.x for p in pts) / len(pts), next(c.score for c in bs if c.category_name == "jawOpen"))
                                for pts, bs in zip(r.face_landmarks, r.face_blendshapes)]))
                n += 1
        finally:
            proc.stdout.close()
            proc.wait()
        return out

    return mouth_for, lm


def run(ctx) -> None:
    """Never fails the job: without people.json the speaker layouts just stay unavailable for this video."""
    if (ctx.media_dir / "people.json").exists():
        ctx.report(1.0)
        return
    try:
        _run(ctx)
    except Cancelled:
        raise
    except Exception as e:  # offline on first use, odd audio, MediaPipe error…
        log.warning("speaker detection skipped: %s", e)
        ctx.report(1.0)


def _run(ctx) -> None:
    md = ctx.media_dir
    faces = json.loads((md / "faces.json").read_text()) if (md / "faces.json").exists() else {}
    if "all" not in faces:  # projects from before Phase 6 kept only the biggest face: look again
        from . import faces as faces_stage
        faces_stage._detect(ctx)
        faces = json.loads((md / "faces.json").read_text())
    report = lambda f, msg=None: ctx.report(f, msg or "Telling voices apart")  # noqa: E731
    m = _models(ctx.data_dir, report)
    speech = Speech(renumber(diarize(md / "audio.wav", m, report)))
    tr = json.loads((md / "transcript.json").read_text())
    if len({spk for _, _, spk in speech.segs}) >= 2:
        label_words(tr["words"], speech)
        tmp = md / "transcript.json.tmp"
        tmp.write_text(json.dumps(tr, ensure_ascii=False))
        tmp.replace(md / "transcript.json")
    report(0.7, "Matching voices to faces")
    mouth_for, lm = _mouth_reader(ctx, m["landmarker"])
    track = json.loads((md / "track.json").read_text())["keyframes"] if (md / "track.json").exists() else [[0, 0.5, 0.5]]
    duration = float(ctx.project.get("durationSec") or probe(md / "proxy.mp4")["duration"])
    try:
        plan = build(duration, faces.get("cuts", []), faces["all"], faces["fps"], speech, mouth_for, track)
    finally:
        lm.close()
    plan["speakers"] = sorted({spk for _, _, spk in speech.segs})
    plan["segments"] = [list(s) for s in speech.segs]
    tmp = md / "people.json.tmp"
    tmp.write_text(json.dumps(plan))
    tmp.replace(md / "people.json")
    ctx.report(1.0)
