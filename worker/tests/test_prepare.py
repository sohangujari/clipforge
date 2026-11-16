import pytest

from clipforge_worker.errors import UserError
from clipforge_worker.stages import prepare
from conftest import ctx_for, probe, row, upload_project


def test_prepare_outputs(conn, data_dir, clips):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    prepare.run(ctx_for(conn))
    m = data_dir / "media" / pid
    v = next(s for s in probe(m / "proxy.mp4")["streams"] if s["codec_type"] == "video")
    assert v["height"] == 480
    a = probe(m / "audio.wav")["streams"][0]
    assert (a["sample_rate"], a["channels"]) == ("16000", 1)
    assert (m / "thumb.jpg").stat().st_size > 0
    assert row(conn, "Project", pid)["durationSec"] == pytest.approx(6, abs=0.3)


def test_no_audio_stream(conn, data_dir, clips):
    upload_project(conn, data_dir, clips["no_audio"])
    with pytest.raises(UserError, match="This video has no audio to transcribe"):
        prepare.run(ctx_for(conn))


def test_silent_audio(conn, data_dir, clips):
    upload_project(conn, data_dir, clips["silent"])
    with pytest.raises(UserError, match="The audio is silent — nothing to transcribe"):
        prepare.run(ctx_for(conn))


def test_prepare_resume_skips_existing(conn, data_dir, clips):
    pid, jid = upload_project(conn, data_dir, clips["with_audio"])
    prepare.run(ctx_for(conn))
    proxy = data_dir / "media" / pid / "proxy.mp4"
    before = proxy.stat().st_mtime_ns
    conn.execute("UPDATE Job SET status='queued' WHERE id=?", (jid,))
    prepare.run(ctx_for(conn))
    assert proxy.stat().st_mtime_ns == before


def test_missing_source_is_readable(conn, data_dir, clips):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    (data_dir / "media" / pid / "source.mp4").unlink()
    with pytest.raises(UserError, match="source video is missing"):
        prepare.run(ctx_for(conn))
