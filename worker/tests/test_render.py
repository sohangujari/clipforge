"""Export: the editor's choices → an MP4 (crop, burned-in subtitles, logo) and a ZIP of every clip."""
import json
import uuid
import zipfile
from pathlib import Path

from clipforge_worker import db
from clipforge_worker.__main__ import stages_for
from clipforge_worker.render.graph import crop_x_expr, safe_filename
from clipforge_worker.runner import run_job
from conftest import probe, row, upload_project

FIX = Path(__file__).resolve().parents[2] / "shared" / "ass-fixtures"
STYLE = json.loads((FIX / "bold-pop.input.json").read_text())["style"]
WORDS = [{"w": w, "s": 0.5 + i * 0.6, "e": 0.9 + i * 0.6} for i, w in enumerate("we set up blind dates for science".split())]


def edit(**kw):
    e = {"aspect": "9:16", "layoutId": "single", "style": STYLE, "subtitlesOn": True, "watermarkOn": False,
         "brand": {"position": "br", "opacity": 80, "sizePct": 12, "marginPct": 4}, "trim": {"start": 0.5, "end": 4.5}, "resolution": "1080p"}
    e.update(kw)
    return e


def project(conn, data_dir, clips, keyframes=((0, 0.5, 0.5),)):
    pid, jid = upload_project(conn, data_dir, clips["with_audio"])  # 1280×720, 6 s, with audio
    conn.execute("UPDATE Job SET status='done' WHERE id=?", (jid,))
    conn.execute("UPDATE Project SET status='ready', durationSec=6, warning='keep me' WHERE id=?", (pid,))
    md = data_dir / "media" / pid
    (md / "transcript.json").write_text(json.dumps({"language": "en", "words": WORDS}))
    (md / "track.json").write_text(json.dumps({"keyframes": [list(k) for k in keyframes]}))
    return pid


def add_clip(conn, pid, e, title="Blind dates"):
    cid = str(uuid.uuid4())
    conn.execute("INSERT INTO Clip (id, projectId, startSec, endSec, score, breakdown, reason, tips, titles, descriptions, hashtags, signals, edit, createdAt) "
                 "VALUES (?,?,?,?,80,'{}','r','[]',?,'{}','[]','{}',?,?)", (cid, pid, 0.5, 4.5, json.dumps([title, "b", "c"]), json.dumps(e) if e else None, db.now_iso()))
    return cid


def render(conn, pid, clip_ids, resolution="1080p", zip_=False):
    jid = str(uuid.uuid4())
    conn.execute("INSERT INTO Job (id, projectId, type, status, stageDone, progress, payload, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
                 (jid, pid, "render", "queued", "[]", 0, json.dumps({"clipIds": clip_ids, "resolution": resolution, "zip": zip_}), db.now_iso(), db.now_iso()))
    job = db.claim_next_job(conn)
    assert job.type == "render"
    assert row(conn, "Project", pid)["status"] == "ready"  # exporting doesn't put the project back into "processing"
    run_job(conn, job, stages_for(job))
    return row(conn, "Job", jid)


def size_of(p: Path):
    v = next(s for s in probe(p)["streams"] if s["codec_type"] == "video")
    return int(v["width"]), int(v["height"])


def test_render_9x16_1080p_has_right_size_duration_and_audio(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    cid = add_clip(conn, pid, edit())
    job = render(conn, pid, [cid])
    assert job["status"] == "done", job["error"]
    out = data_dir / "renders" / f"{cid}-1080p.mp4"
    info = probe(out)
    assert size_of(out) == (1080, 1920)
    assert abs(float(info["format"]["duration"]) - 4.0) < 0.15
    assert any(s["codec_type"] == "audio" for s in info["streams"])
    assert not list((data_dir / "renders").glob("*.tmp*"))


def test_render_720p_16x9_and_1x1(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    a, b = add_clip(conn, pid, edit(aspect="16:9", resolution="720p")), add_clip(conn, pid, edit(aspect="1:1", resolution="720p"))
    assert render(conn, pid, [a, b], "720p")["status"] == "done"
    assert size_of(data_dir / "renders" / f"{a}-720p.mp4") == (1280, 720)
    assert size_of(data_dir / "renders" / f"{b}-720p.mp4") == (720, 720)


def test_wide_blur_layout_renders(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    cid = add_clip(conn, pid, edit(layoutId="wide-blur"))
    assert render(conn, pid, [cid])["status"] == "done"
    assert size_of(data_dir / "renders" / f"{cid}-1080p.mp4") == (1080, 1920)


def test_moving_crop_expression_follows_keyframes():
    expr = crop_x_expr([(0, 0.2, 0.5), (2, 0.8, 0.5)], 0, 4, 1920, 1080, 9 / 16)
    ev = lambda t: _eval(expr, t)  # noqa: E731
    assert ev(0) == 80                                 # crop_rect(0.2) → x 80
    assert abs(ev(1) - (80 + 1232) / 2) <= 2           # halfway
    assert ev(3) == 1232                               # holds after the last keyframe
    assert crop_x_expr([(0, 0.5, 0.5)], 0, 4, 1920, 1080, 9 / 16) == "656"  # still: a plain number


def _eval(expr: str, t: float) -> float:
    """Tiny evaluator for the if/lt/arithmetic subset crop_x_expr emits."""
    import re
    py = re.sub(r"if\(lt\(t,([\d.]+)\),", r"_if(t<\1,", expr)
    return round(eval(py, {"_if": lambda c, a, b: a if c else b, "t": t}))


def test_empty_words_and_trim_past_the_end_still_render(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    (data_dir / "media" / pid / "transcript.json").write_text(json.dumps({"language": "en", "words": []}))
    cid = add_clip(conn, pid, edit(trim={"start": 3, "end": 11}))
    assert render(conn, pid, [cid])["status"] == "done"
    assert abs(float(probe(data_dir / "renders" / f"{cid}-1080p.mp4")["format"]["duration"]) - 3.0) < 0.15


def test_zip_contains_every_clip_with_title_names(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    a, b = add_clip(conn, pid, edit(), "Blind dates / science"), add_clip(conn, pid, edit(), "Blind dates / science")
    assert render(conn, pid, [a, b], zip_=True)["status"] == "done"
    with zipfile.ZipFile(data_dir / "renders" / f"{pid}-clips.zip") as z:
        assert sorted(z.namelist()) == ["01 Blind dates science.mp4", "02 Blind dates science.mp4"]


def test_render_job_leaves_project_status_and_warning_alone(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    cid = add_clip(conn, pid, edit())
    (data_dir / "media" / pid / "source.mp4").unlink()  # make it fail
    job = render(conn, pid, [cid])
    assert job["status"] == "failed" and job["error"]
    p = row(conn, "Project", pid)
    assert p["status"] == "ready" and p["warning"] == "keep me"


def test_logo_png_is_overlaid(conn, data_dir, clips):
    import subprocess
    pid = project(conn, data_dir, clips)
    (data_dir / "logos").mkdir(exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=red:s=200x100", "-frames:v", "1", "-y", str(data_dir / "logos" / "l.png")], check=True)
    cid = add_clip(conn, pid, edit(watermarkOn=True, brand={"logoPath": "logos/l.png", "position": "tl", "opacity": 100, "sizePct": 20, "marginPct": 4}))
    assert render(conn, pid, [cid])["status"] == "done"
    px = subprocess.run(["ffmpeg", "-v", "error", "-ss", "1", "-i", str(data_dir / "renders" / f"{cid}-1080p.mp4"), "-vf", "crop=10:10:60:60", "-frames:v", "1",
                         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    r, g, b = px[0], px[1], px[2]
    assert r > 200 and g < 60 and b < 60  # red logo in the top-left, inside the 4% margin


def test_svg_logo_uses_its_png_companion(conn, data_dir, clips):
    import subprocess
    pid = project(conn, data_dir, clips)
    (data_dir / "logos").mkdir(exist_ok=True)
    (data_dir / "logos" / "l.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=red:s=200x100", "-frames:v", "1", "-y", str(data_dir / "logos" / "l.png")], check=True)
    cid = add_clip(conn, pid, edit(watermarkOn=True, brand={"logoPath": "logos/l.svg", "logoPngPath": "logos/l.png", "position": "tl", "opacity": 100,
                                                          "sizePct": 20, "marginPct": 4}))
    assert render(conn, pid, [cid])["status"] == "done"


def test_filenames_and_paths_are_safe():
    assert safe_filename('A/B: "Hi" 🎉', "mp4") == "A B Hi 🎉.mp4"
    assert safe_filename("", "mp4") == "clip.mp4"
    assert len(safe_filename("x" * 300, "mp4")) <= 84


def test_rotated_phone_video_is_probed_upright(clips, tmp_path):
    import subprocess
    from clipforge_worker.media import probe as media_probe
    rot = tmp_path / "rot.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-display_rotation", "90", "-i", str(clips["with_audio"]), "-c", "copy", str(rot)], check=True)
    p = media_probe(rot)
    assert (p["width"], p["height"]) == (720, 1280)  # what FFmpeg actually decodes (auto-rotated)


def test_a_broken_fonts_link_from_a_moved_folder_is_repaired(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    (data_dir / "renders").mkdir(exist_ok=True)
    (data_dir / "renders" / ".fonts").symlink_to("/nonexistent/old/repo/web/public/fonts")
    cid = add_clip(conn, pid, edit())
    assert render(conn, pid, [cid])["status"] == "done"


def test_clip_without_an_edit_uses_the_defaults_sent_with_the_job(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    cid = add_clip(conn, pid, None)
    jid = str(uuid.uuid4())
    payload = {"clipIds": [cid], "resolution": "720p", "zip": False, "edits": {cid: edit(resolution="720p")}}
    conn.execute("INSERT INTO Job (id, projectId, type, status, stageDone, progress, payload, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
                 (jid, pid, "render", "queued", "[]", 0, json.dumps(payload), db.now_iso(), db.now_iso()))
    job = db.claim_next_job(conn)
    run_job(conn, job, stages_for(job))
    assert row(conn, "Job", jid)["status"] == "done", row(conn, "Job", jid)["error"]


def test_edit_without_brand_uses_the_current_brand_kit(conn, data_dir, clips):
    import subprocess
    pid = project(conn, data_dir, clips)
    (data_dir / "logos").mkdir(exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=red:s=200x100", "-frames:v", "1", "-y", str(data_dir / "logos" / "l.png")], check=True)
    conn.execute("INSERT INTO Setting (key, value, updatedAt) VALUES ('brandKit', ?, ?)",
                 (json.dumps({"logoPath": "logos/l.png", "position": "tl", "opacity": 100, "sizePct": 20, "marginPct": 4}), db.now_iso()))
    e = edit(watermarkOn=True)
    del e["brand"]
    cid = add_clip(conn, pid, e)
    assert render(conn, pid, [cid])["status"] == "done"
    px = subprocess.run(["ffmpeg", "-v", "error", "-ss", "1", "-i", str(data_dir / "renders" / f"{cid}-1080p.mp4"), "-vf", "crop=10:10:60:60", "-frames:v", "1",
                         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    assert px[0] > 200 and px[1] < 60  # today's Settings logo, though the clip was edited before
