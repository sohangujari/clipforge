"""Get the source video into data/media/<id>/source.<ext>: download URLs with yt-dlp, verify uploads."""
import os
import re
import shutil

import yt_dlp

from ..errors import UserError
from ..media import source_path

FORMAT = "bestvideo[height<=1080]+bestaudio/best"
FINISHED = re.compile(r"^source\.(mp4|mkv|webm|mov)$")  # not source.f137.mp4 (an unmerged stream)

_READABLE = [
    (("Private video", "Video unavailable", "This video is not available", "has been removed"), "Video is private or unavailable"),
    (("Sign in to confirm your age",), "This video is age-restricted — set YT_BROWSER_COOKIES to a browser you're signed into (see README)"),
    (("not available in your country", "not made this video available in your country"), "This video is blocked in your region"),
    (("Unsupported URL",), "This link isn't a supported video page"),
    (("getaddrinfo", "timed out", "Connection", "nodename nor servname"), "Couldn't reach the site — check your internet connection"),
]


def readable_download_error(msg: str) -> str:
    for needles, text in _READABLE:
        if any(n in msg for n in needles):
            return text
    first = (msg.strip().splitlines() or [""])[0]
    return f"Download failed: {first[:200]}"


def run(ctx) -> None:
    if ctx.project["sourceType"] == "upload":
        source_path(ctx)
        ctx.report(1.0)
        return
    existing = next((p for p in ctx.media_dir.glob("source.*") if FINISHED.match(p.name)), None)
    if existing and existing.stat().st_size > 0:
        ctx.set_project(sourceFile=str(existing.relative_to(ctx.data_dir)))
        ctx.report(1.0)
        return

    def hook(d):
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if d.get("status") in ("downloading", "finished") and total:
            ctx.report(min(1.0, d.get("downloaded_bytes", 0) / total), "Downloading")

    opts = {
        "format": FORMAT, "merge_output_format": "mp4", "noplaylist": True, "quiet": True, "no_warnings": True,
        "noprogress": True,  # we report progress through the hook; yt-dlp's own bar floods the log
        "outtmpl": str(ctx.media_dir / "source.%(ext)s"), "progress_hooks": [hook],
        "extractor_args": {"youtube": {"player_client": ["default", "android"]}},
    }
    if node := shutil.which("node"):
        opts["js_runtimes"] = {"node": {"path": node}}  # YouTube needs a JS runtime for signatures
    if browser := os.environ.get("YT_BROWSER_COOKIES"):
        opts["cookiesfrombrowser"] = (browser,)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(ctx.project["sourceUrl"], download=True)
    except yt_dlp.utils.DownloadError as e:
        raise UserError(readable_download_error(str(e))) from e
    src = next((p for p in ctx.media_dir.glob("source.*") if FINISHED.match(p.name)), None)
    if not src:
        raise UserError("Download finished but no video file was produced")
    ctx.set_project(title=(info.get("title") or ctx.project["title"])[:200], sourceFile=str(src.relative_to(ctx.data_dir)))
    ctx.report(1.0)
