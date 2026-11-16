import pytest

from clipforge_worker.errors import UserError
from clipforge_worker.stages import importer
from conftest import add_project, ctx_for, row


@pytest.mark.parametrize("msg,expected", [
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "Video is private or unavailable"),
    ("ERROR: [youtube] abc: Video unavailable", "Video is private or unavailable"),
    ("ERROR: [youtube] abc: Sign in to confirm your age.", "This video is age-restricted — set YT_BROWSER_COOKIES to a browser you're signed into (see README)"),
    ("ERROR: The uploader has not made this video available in your country", "This video is blocked in your region"),
    ("ERROR: Unsupported URL: https://example.com/x", "This link isn't a supported video page"),
    ("ERROR: Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided, or not known> getaddrinfo", "Couldn't reach the site — check your internet connection"),
    ("ERROR: something odd happened\nTraceback", "Download failed: ERROR: something odd happened"),
])
def test_yt_dlp_errors_become_readable(msg, expected):
    assert importer.readable_download_error(msg) == expected


class FakeYDL:
    last_opts = None

    def __init__(self, opts):
        FakeYDL.last_opts = opts
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=True):
        for hook in self.opts["progress_hooks"]:
            hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100})
            hook({"status": "finished", "downloaded_bytes": 100, "total_bytes": 100})
        out = self.opts["outtmpl"].replace("%(ext)s", "mp4")
        open(out, "wb").write(b"x")
        return {"title": "My Video", "ext": "mp4"}


def test_import_uses_progress_and_sets_title(conn, data_dir, monkeypatch):
    pid, _ = add_project(conn, source_type="url", source_url="https://www.youtube.com/watch?v=abc")
    monkeypatch.setattr(importer.yt_dlp, "YoutubeDL", FakeYDL)
    ctx = ctx_for(conn)
    fractions = []
    real = ctx.report
    ctx.report = lambda f, message=None: (fractions.append(f), real(f, message))
    importer.run(ctx)
    p = row(conn, "Project", pid)
    assert p["title"] == "My Video"
    assert p["sourceFile"] == f"media/{pid}/source.mp4"
    assert 0.5 in fractions
    assert FakeYDL.last_opts["noplaylist"] is True
    assert FakeYDL.last_opts["format"] == "bestvideo[height<=1080]+bestaudio/best"


def test_download_error_becomes_user_error(conn, data_dir, monkeypatch):
    add_project(conn, source_type="url", source_url="https://www.youtube.com/watch?v=abc")

    class Boom(FakeYDL):
        def extract_info(self, url, download=True):
            raise importer.yt_dlp.utils.DownloadError("ERROR: [youtube] abc: Video unavailable")
    monkeypatch.setattr(importer.yt_dlp, "YoutubeDL", Boom)
    with pytest.raises(UserError, match="Video is private or unavailable"):
        importer.run(ctx_for(conn))


def test_upload_project_import_is_a_check(conn, data_dir):
    pid, _ = add_project(conn, source_file="media/x/source.mp4")
    with pytest.raises(UserError, match="source video is missing"):
        importer.run(ctx_for(conn))
