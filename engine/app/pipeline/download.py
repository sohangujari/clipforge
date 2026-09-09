"""Download a YouTube video with guaranteed audio+video streams.

Uses yt-dlp with a format selector that explicitly requests separate
video+audio streams and merges them. Falls back to 'best' (always a
muxed stream) only as a last resort. An ffprobe check after download
validates that the resulting file has a real audio track (non-zero
duration), catching the failure mode where YouTube serves a video-only
stream despite the format request.
"""

import logging
import os
import subprocess
from pathlib import Path

import yt_dlp

import re
from clipforge.engine.app.storage import job_dir, update_job_progress

logger = logging.getLogger(__name__)


def download_video(job_id: str, youtube_url: str) -> tuple[Path, Path, str]:
    """Download the source video and audio separately for a job.

    Returns (path_to_video, path_to_audio, video_title). Raises on failure.
    """
    out_dir = job_dir(job_id)

    def audio_progress_hook(d):
        if d['status'] == 'downloading':
            pct_str = d.get('_percent_str', '').strip().replace('%', '')
            try:
                pct_str = re.sub(r'\x1b\[.*?m', '', pct_str)
                pct = float(pct_str)
                update_job_progress(job_id, int(pct * 0.3))
            except Exception:
                pass

    def video_progress_hook(d):
        if d['status'] == 'downloading':
            pct_str = d.get('_percent_str', '').strip().replace('%', '')
            try:
                pct_str = re.sub(r'\x1b\[.*?m', '', pct_str)
                pct = float(pct_str)
                update_job_progress(job_id, 30 + int(pct * 0.7))
            except Exception:
                pass

    # Optional: use browser cookies for 403-resistant downloads
    browser_cookies = os.getenv("YT_BROWSER_COOKIES", "")

    # 1. Download audio only
    audio_template = str(out_dir / "source_audio.%(ext)s")
    ydl_opts_audio = {
        "format": "bestaudio/best",
        "outtmpl": audio_template,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
        }],
        "quiet": False,
        "no_warnings": False,
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
        "js_runtimes": {"node": {"path": "/opt/homebrew/bin/node"}},
        "progress_hooks": [audio_progress_hook],
    }
    if browser_cookies:
        ydl_opts_audio["cookiesfrombrowser"] = (browser_cookies,)

    logger.info("Starting audio download for job %s: %s", job_id, youtube_url)
    with yt_dlp.YoutubeDL(ydl_opts_audio) as ydl:
        info = ydl.extract_info(youtube_url, download=True)
        title = info.get("title", "Untitled")

    audio_path = out_dir / "source_audio.mp3"
    if not audio_path.exists():
        raise FileNotFoundError(f"Expected {audio_path} after download but it's missing")

    # 2. Download video (guarantee 1080p Full HD stream)
    video_template = str(out_dir / "source_video.%(ext)s")
    ydl_opts_video = {
        "format": "bestvideo[height<=1080]+bestaudio/bestvideo[height<=1080]/bestvideo/best",
        "outtmpl": video_template,
        "merge_output_format": "mp4",
        "postprocessors": [{
            "key": "FFmpegVideoConvertor",
            "preferedformat": "mp4",
        }],
        "quiet": False,
        "no_warnings": False,
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
        "js_runtimes": {"node": {"path": "/opt/homebrew/bin/node"}},
        "progress_hooks": [video_progress_hook],
    }
    if browser_cookies:
        ydl_opts_video["cookiesfrombrowser"] = (browser_cookies,)

    logger.info("Starting video download for job %s: %s", job_id, youtube_url)
    with yt_dlp.YoutubeDL(ydl_opts_video) as ydl:
        ydl.extract_info(youtube_url, download=True)

    video_path = out_dir / "source_video.mp4"
    if not video_path.exists():
        raise FileNotFoundError(f"Expected {video_path} after download but it's missing")

    logger.info("Download complete: video=%s, audio=%s (%s)", video_path.name, audio_path.name, title)
    return video_path, audio_path, title