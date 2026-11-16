import json
import os
import shutil
import sqlite3
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

WEB = Path(__file__).resolve().parents[2] / "web"


@pytest.fixture(scope="session")
def template_db(tmp_path_factory) -> Path:
    """The real schema, pushed once by Prisma so Python and Next agree on columns."""
    d = tmp_path_factory.mktemp("template")
    subprocess.run(["npx", "prisma", "db", "push"], cwd=WEB, env={**os.environ, "CLIPFORGE_DATA_DIR": str(d)},
                   check=True, capture_output=True)
    return d / "clipforge.db"


@pytest.fixture
def data_dir(tmp_path, template_db, monkeypatch) -> Path:
    shutil.copy(template_db, tmp_path / "clipforge.db")
    monkeypatch.setenv("CLIPFORGE_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def conn(data_dir):
    from clipforge_worker import db
    c = db.connect()
    yield c
    c.close()


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def add_project(conn: sqlite3.Connection, *, source_type="upload", source_file=None, source_url=None,
                settings=None, job_status="queued", stage_done=(), created=None, heartbeat=None) -> tuple[str, str]:
    pid, jid = str(uuid.uuid4()), str(uuid.uuid4())
    now = iso(created or datetime.now(timezone.utc))
    s = {"clipCount": "auto", "lengthRange": [30, 90], "language": "auto", "tone": "neutral", "vocabulary": [], "captionScript": "native"}
    s.update(settings or {})
    conn.execute('INSERT INTO Project (id,title,sourceType,sourceUrl,sourceFile,status,contentType,settings,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
                 (pid, "t", source_type, source_url, source_file, "queued", "auto", json.dumps(s), now, now))
    conn.execute('INSERT INTO Job (id,projectId,type,status,stageDone,progress,heartbeat,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
                 (jid, pid, "ingest", job_status, json.dumps(list(stage_done)), 0, iso(heartbeat) if heartbeat else None, now, now))
    return pid, jid


def row(conn, table, id_):
    conn.row_factory = sqlite3.Row
    r = conn.execute(f"SELECT * FROM {table} WHERE id=?", (id_,)).fetchone()
    return dict(r) if r else None


@pytest.fixture
def ago():
    return lambda **kw: datetime.now(timezone.utc) - timedelta(**kw)


def _ffmpeg(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


@pytest.fixture(scope="session")
def clips(tmp_path_factory) -> dict[str, Path]:
    d = tmp_path_factory.mktemp("clips")
    v = ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6"]
    _ffmpeg(*v, "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(d / "with_audio.mp4"))
    _ffmpeg(*v, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(d / "no_audio.mp4"))
    _ffmpeg(*v, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(d / "silent.mp4"))
    _ffmpeg("-f", "lavfi", "-i", "testsrc2=size=160x90:rate=5:duration=120", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(d / "long_proxy.mp4"))
    return {p.stem: p for p in d.iterdir()}


def upload_project(conn, data_dir: Path, src: Path, **kw):
    """An upload project whose source file is already in data/media/<id>/."""
    pid, jid = add_project(conn, **kw)
    dest = data_dir / "media" / pid
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dest / "source.mp4")
    conn.execute("UPDATE Project SET sourceFile=? WHERE id=?", (f"media/{pid}/source.mp4", pid))
    return pid, jid


def ctx_for(conn, stage="s"):
    from clipforge_worker import db
    from clipforge_worker.runner import StageContext
    job = db.claim_next_job(conn)
    return StageContext(conn, job, stage, 0, 1)


def probe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)
