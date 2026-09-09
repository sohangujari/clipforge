"""Word-level transcription via faster-whisper.

Extracts audio to a temporary WAV file before transcribing to avoid
container-format issues with certain mp4 files. faster-whisper downloads
the model weights on first use (a few hundred MB to a few GB depending
on WHISPER_MODEL_SIZE), so the first call will be slow.
"""

import logging
import subprocess
import tempfile
from pathlib import Path

from faster_whisper import WhisperModel

from clipforge.engine.app.config import WHISPER_COMPUTE_TYPE, WHISPER_DEVICE, WHISPER_MODEL_SIZE
from clipforge.engine.app.models.schemas import WordTiming

logger = logging.getLogger(__name__)

_model: WhisperModel | None = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        logger.info(
            "Loading Whisper model: size=%s, device=%s, compute=%s",
            WHISPER_MODEL_SIZE, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE,
        )
        _model = WhisperModel(
            WHISPER_MODEL_SIZE, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE
        )
        logger.info("Whisper model loaded successfully")
    return _model


def _extract_audio(source_audio_path: Path, wav_path: Path) -> None:
    """Extract audio from source audio file to a WAV file using ffmpeg."""
    logger.info("Extracting audio from %s → %s", source_audio_path.name, wav_path.name)
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(source_audio_path),
            "-vn",                      # no video
            "-acodec", "pcm_s16le",     # 16-bit PCM
            "-ar", "16000",             # 16kHz (what Whisper expects)
            "-ac", "1",                 # mono
            str(wav_path),
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg audio extraction failed (exit {result.returncode}): "
            f"{result.stderr[:500]}"
        )
    if not wav_path.exists() or wav_path.stat().st_size == 0:
        raise RuntimeError(
            "ffmpeg produced an empty audio file — the source video may "
            "have no usable audio track."
        )
    logger.info("Audio extracted: %.1f MB", wav_path.stat().st_size / 1_048_576)


from clipforge.engine.app.storage import update_job_progress

def transcribe(job_id: str, audio_path: Path) -> tuple[str, list[WordTiming]]:
    """Returns (detected_language_code, word_timings).

    Extracts audio to WAV first for reliable transcription, then runs
    faster-whisper with word-level timestamps enabled.
    """
    model = _get_model()

    # Extract audio to a temp WAV file for reliable transcription
    with tempfile.TemporaryDirectory() as tmp_dir:
        wav_path = Path(tmp_dir) / "audio.wav"
        _extract_audio(audio_path, wav_path)

        logger.info("Starting transcription of %s", wav_path.name)
        segments, info = model.transcribe(
            str(wav_path),
            word_timestamps=True,
            vad_filter=True,  # skip silence for faster processing
        )

        duration = info.duration
        words: list[WordTiming] = []
        segment_count = 0
        last_pct = -1

        for segment in segments:
            segment_count += 1
            for w in segment.words or []:
                words.append(WordTiming(word=w.word.strip(), start=w.start, end=w.end))
            
            if duration > 0:
                pct = int((segment.end / duration) * 100)
                pct = max(0, min(100, pct))
                if pct >= last_pct + 2:
                    last_pct = pct
                    update_job_progress(job_id, pct)

    logger.info(
        "Transcription complete: language=%s, segments=%d, words=%d",
        info.language, segment_count, len(words),
    )

    if not words:
        raise RuntimeError(
            f"Transcription produced 0 words from {audio_path.name}. "
            "The audio track may be silent, corrupted, or in an unsupported format. "
            "Check the source video's audio with: "
            f"ffplay -nodisp -autoexit '{audio_path}'"
        )

    return info.language, words
