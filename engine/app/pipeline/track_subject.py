"""Single-speaker face tracking to drive the 9:16 crop window.

Uses Mediapipe Face Detection at ~5fps to locate the speaker, then
smooths the crop path with an exponential moving average so the virtual
pan doesn't jitter. Detects hard scene cuts via frame histogram deltas
and resets smoothing at each cut.

Returns a list of (timestamp, crop_x_center_fraction) keyframes that
render_clip.py uses to build the ffmpeg crop expression.
"""

import logging
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Sampling rate for face detection (frames per second)
_SAMPLE_FPS = 5.0
# EMA smoothing factor (lower = smoother, higher = more responsive)
_SMOOTH_ALPHA = 0.15
# Scene cut threshold (normalized histogram correlation; lower = more sensitive)
_SCENE_CUT_THRESHOLD = 0.4


def _get_face_detector():
    """Initializes and returns a face detector instance."""
    try:
        import mediapipe as mp
        if hasattr(mp, "tasks") and hasattr(mp.tasks, "vision"):
            model_path = Path(__file__).parent.parent.parent / "blaze_face_short_range.tflite"
            if not model_path.exists():
                import urllib.request, ssl
                url = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, context=ctx) as resp, open(model_path, "wb") as f:
                    f.write(resp.read())
            
            BaseOptions = mp.tasks.BaseOptions
            FaceDetector = mp.tasks.vision.FaceDetector
            FaceDetectorOptions = mp.tasks.vision.FaceDetectorOptions
            RunningMode = mp.tasks.vision.RunningMode

            options = FaceDetectorOptions(
                base_options=BaseOptions(model_asset_path=str(model_path)),
                running_mode=RunningMode.IMAGE,
                min_detection_confidence=0.4
            )
            return ("tasks", FaceDetector.create_from_options(options))
        elif hasattr(mp, "solutions") and hasattr(mp.solutions, "face_detection"):
            return ("solutions", mp.solutions.face_detection.FaceDetection(
                model_selection=0,
                min_detection_confidence=0.5
            ))
    except Exception as e:
        logger.warning("Mediapipe initialization failed: %s", e)
    return (None, None)


def _detect_faces_mediapipe(video_path: Path, start: float, end: float):
    """Sample frames and detect face bounding boxes using Mediapipe."""
    mode, detector = _get_face_detector()
    if detector is None:
        logger.warning("No face detector available — falling back to center crop")
        return []

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    sample_interval = max(1, int(fps / _SAMPLE_FPS))

    start_frame = int(start * fps)
    end_frame = int(end * fps)
    detections: list[tuple[float, float | None, bool, float | None]] = []  # (timestamp, x_center, is_scene_cut, y_center)
    prev_hist = None

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
    import mediapipe as mp

    frame_idx = start_frame
    while frame_idx <= end_frame:
        ret, frame = cap.read()
        if not ret:
            break

        if (frame_idx - start_frame) % sample_interval != 0:
            frame_idx += 1
            continue

        timestamp = frame_idx / fps

        # Scene cut detection via histogram correlation
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        hist = cv2.calcHist([gray], [0], None, [64], [0, 256])
        cv2.normalize(hist, hist)

        is_scene_cut = False
        if prev_hist is not None:
            corr = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)
            if corr < _SCENE_CUT_THRESHOLD:
                is_scene_cut = True
                logger.debug("Scene cut detected at t=%.2f (corr=%.3f)", timestamp, corr)
        prev_hist = hist

        # Face detection
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        x_center = None
        y_center = None

        try:
            if mode == "tasks":
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                results = detector.detect(mp_image)
                if results.detections:
                    best = max(
                        results.detections,
                        key=lambda d: d.bounding_box.width * d.bounding_box.height,
                    )
                    bb = best.bounding_box
                    x_center = (bb.origin_x + bb.width / 2.0) / frame_width
                    x_center = max(0.0, min(1.0, x_center))
                    y_center = (bb.origin_y + bb.height / 2.0) / frame_height
                    y_center = max(0.0, min(1.0, y_center))
            elif mode == "solutions":
                results = detector.process(rgb)
                if results.detections:
                    best = max(
                        results.detections,
                        key=lambda d: d.location_data.relative_bounding_box.width
                        * d.location_data.relative_bounding_box.height,
                    )
                    bb = best.location_data.relative_bounding_box
                    x_center = bb.xmin + bb.width / 2.0
                    x_center = max(0.0, min(1.0, x_center))
                    y_center = bb.ymin + bb.height / 2.0
                    y_center = max(0.0, min(1.0, y_center))
        except Exception as e:
            logger.debug("Face detect frame error: %s", e)

        detections.append((timestamp, x_center, is_scene_cut, y_center))
        frame_idx += 1

    cap.release()
    return detections


def compute_auto_subtitle_position(raw_detections: list) -> str:
    """Determine the optimal subtitle position ('bottom', 'center', or 'top').
    
    1. Multi-speaker split screen (faces at top y < 0.45 AND bottom y > 0.55):
       -> 'center' (places captions directly on the horizontal dividing line)
    2. Speaker in lower half / reaction webcam at bottom (avg y_center > 0.65):
       -> 'top' (upper third to avoid covering speaker)
    3. Speaker in upper half / standard talking head (avg y_center <= 0.65):
       -> 'bottom' (safe area at bottom)
    """
    valid_y = [d[3] for d in raw_detections if len(d) > 3 and d[3] is not None]
    if not valid_y:
        return "bottom"

    avg_y = sum(valid_y) / len(valid_y)
    has_top = any(y < 0.40 for y in valid_y)
    has_bottom = any(y > 0.60 for y in valid_y)

    if has_top and has_bottom:
        return "center"
    elif avg_y > 0.65:
        return "top"
    else:
        return "bottom"


def compute_crop_and_layout(
    video_path: Path, start: float, end: float
) -> tuple[list[tuple[float, float]], str]:
    """Returns (crop_path, auto_subtitle_position)."""
    logger.info("Computing crop path and layout for %.1f–%.1f", start, end)
    raw_detections = _detect_faces_mediapipe(video_path, start, end)

    if not raw_detections:
        logger.warning("No detections at all — using center crop and bottom position")
        return [(start, 0.5), (end, 0.5)], "bottom"

    auto_pos = compute_auto_subtitle_position(raw_detections)
    logger.info("Detected auto subtitle position: %s", auto_pos)

    # Apply EMA smoothing with scene-cut resets
    smoothed: list[tuple[float, float]] = []
    ema_x = None
    last_known_x = 0.5

    for entry in raw_detections:
        timestamp = entry[0]
        x_center = entry[1]
        is_scene_cut = entry[2] if len(entry) > 2 else False

        if is_scene_cut:
            ema_x = None

        if x_center is not None:
            last_known_x = x_center
            if ema_x is None:
                ema_x = x_center
            else:
                ema_x = _SMOOTH_ALPHA * x_center + (1 - _SMOOTH_ALPHA) * ema_x
        else:
            if ema_x is None:
                ema_x = last_known_x

        smoothed.append((timestamp, ema_x))

    has_faces = any(entry[1] is not None for entry in raw_detections)
    if not has_faces:
        logger.warning("No faces detected in any frame — using center crop")
        return [(start, 0.5), (end, 0.5)], auto_pos

    logger.info("Crop path computed: %d keyframes, position: %s", len(smoothed), auto_pos)
    return smoothed, auto_pos


def compute_crop_path(
    video_path: Path, start: float, end: float
) -> list[tuple[float, float]]:
    """Backwards-compatible wrapper."""
    path, _ = compute_crop_and_layout(video_path, start, end)
    return path
