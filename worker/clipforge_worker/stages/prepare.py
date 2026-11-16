"""Probe the source, then make the 480p proxy, the 16 kHz mono WAV and a thumbnail. Each output is a checkpoint."""
from ..errors import UserError
from ..media import ffmpeg, mean_volume_db, probe, source_path

SILENT_DB = -60.0
PROXY_HW = ["-vf", "scale=-2:480", "-c:v", "h264_videotoolbox", "-b:v", "1200k"]
PROXY_SW = ["-vf", "scale=-2:480", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28"]
AUDIO = ["-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"]


def done(path) -> bool:
    return path.exists() and path.stat().st_size > 0


def run(ctx) -> None:
    src = source_path(ctx)
    info = probe(src)
    if not info["has_audio"]:
        raise UserError("This video has no audio to transcribe")
    ctx.set_project(durationSec=round(info["duration"], 2))
    dur, out = info["duration"], ctx.media_dir

    proxy = out / "proxy.mp4"
    if not done(proxy):
        prog = lambda f: ctx.report(f * 0.75)
        # VideoToolbox = the M-series hardware encoder; fall back to x264 elsewhere or if it refuses.
        if not ffmpeg(["-i", str(src), *PROXY_HW, *AUDIO], proxy, dur, prog) and not ffmpeg(["-i", str(src), *PROXY_SW, *AUDIO], proxy, dur, prog):
            raise UserError("Couldn't convert this video — the file may be damaged")

    wav = out / "audio.wav"
    if not done(wav):
        if not ffmpeg(["-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"], wav, dur, lambda f: ctx.report(0.75 + f * 0.15)):
            raise UserError("Couldn't read the audio track")
    if mean_volume_db(wav) < SILENT_DB:
        raise UserError("The audio is silent — nothing to transcribe")

    thumb = out / "thumb.jpg"
    if not done(thumb):
        at = min(dur * 0.1, 30.0)
        ffmpeg(["-ss", f"{at:.2f}", "-i", str(src), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4"], thumb)  # best effort
    ctx.report(1.0)
