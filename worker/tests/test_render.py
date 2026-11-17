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


def _durations(p: Path):
    info = probe(p)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next(s for s in info["streams"] if s["codec_type"] == "audio")
    return float(v["duration"]), float(a["duration"])


def test_cuts_zoom_and_hook_render_with_sound_and_picture_in_step(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    e = edit(keep=[[0.5, 1.5], [2.1, 3.0], [3.6, 4.5]], zooms=[[2.2, 3.2]], autoZoom=True, hook={"on": True, "text": "Watch this"})
    cid = add_clip(conn, pid, e)
    job = render(conn, pid, [cid])
    assert job["status"] == "done", job["error"]
    v, a = _durations(data_dir / "renders" / f"{cid}-1080p.mp4")
    assert abs(v - 2.8) < 0.1 and abs(a - v) < 0.06  # 4 s trim minus 1.2 s of cuts; no drift between sound and picture


def test_intro_and_outro_wrap_the_clip(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    (data_dir / "bumpers").mkdir(exist_ok=True)
    import shutil
    shutil.copy(clips["no_audio"], data_dir / "bumpers" / "in.mp4")
    brand = {"position": "br", "opacity": 80, "sizePct": 12, "marginPct": 4, "introPath": "bumpers/in.mp4", "outroPath": "bumpers/missing.mp4"}
    cid = add_clip(conn, pid, edit(brand=brand, bumpers=True))
    job = render(conn, pid, [cid])
    assert job["status"] == "done", job["error"]
    v, a = _durations(data_dir / "renders" / f"{cid}-1080p.mp4")
    intro = float(probe(data_dir / "bumpers" / "in.mp4")["format"]["duration"])
    assert abs(v - (4.0 + intro)) < 0.2 and abs(a - v) < 0.1  # missing outro file: skipped, not an error
    off = add_clip(conn, pid, edit(brand=brand, bumpers=False))
    assert render(conn, pid, [off])["status"] == "done"
    assert abs(_durations(data_dir / "renders" / f"{off}-1080p.mp4")[0] - 4.0) < 0.15


def _people(md):
    rows2 = [[[0, 0.3, 0.4]], [[0, 0.7, 0.4]]]
    plan = {"track": [[0, 0.3, 0.4], [3, 0.3, 0.4], [3.001, 0.7, 0.4]], "faceH": 0.2, "multi": True, "speakers": [0, 1], "segments": [],
            "split": {"ranges": [[1, 3.5, 2]], "tracks": {"2": rows2}},
            "grid": {"ranges": [[1, 3.5, 2]], "tracks": {"2": rows2}, "active": [[1, 2, 2, 0], [2, 3.5, 2, 1]]}}
    (md / "people.json").write_text(json.dumps(plan))


def test_speaker_layouts_render_from_the_speaker_plan(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    _people(data_dir / "media" / pid)
    ids = [add_clip(conn, pid, edit(layoutId=l)) for l in ("active-speaker", "split", "grid")] + [add_clip(conn, pid, edit(layoutId="split", aspect="16:9"))]
    job = render(conn, pid, ids)
    assert job["status"] == "done", job["error"]
    for cid in ids[:3]:
        out = data_dir / "renders" / f"{cid}-1080p.mp4"
        assert size_of(out) == (1080, 1920) and abs(float(probe(out)["format"]["duration"]) - 4.0) < 0.15
    assert size_of(data_dir / "renders" / f"{ids[3]}-1080p.mp4") == (1920, 1080)


def test_split_rows_crop_each_person_and_subtitles_move_to_the_divider(tmp_path):
    from clipforge_worker.render.graph import build_command
    rows = {"ranges": [[10, 20, 2], [30, 40, 2]], "tracks": {"2": [[[0, 0.3, 0.4]], [[0, 0.7, 0.4]]]}, "faceH": 0.2}
    cmd = build_command(Path("s.mp4"), "o.mp4", edit(layoutId="split"), [[0, 0.5, 0.5]], 1920, 1080, 12, 25, None, "a.ass", "libx264", rows=rows)
    g = cmd[cmd.index("-filter_complex") + 1]
    assert "vstack=inputs=2" in g and "enable='between(t,0,8)'" in g  # only the part of the range inside the clip, clip-relative
    assert g.count("crop=w=776:h=690") == 2  # a tight row crop per person (3.2 face heights), not the full-height 9:8


def test_a_shot_with_no_face_shows_the_whole_frame_over_a_blur(conn, data_dir, clips):
    pid = project(conn, data_dir, clips)
    md = data_dir / "media" / pid
    (md / "track.json").write_text(json.dumps({"keyframes": [[0, 0.3, 0.4]], "wide": [[1.0, 2.5]]}))
    cid = add_clip(conn, pid, edit())
    assert render(conn, pid, [cid])["status"] == "done"
    out = data_dir / "renders" / f"{cid}-1080p.mp4"
    assert size_of(out) == (1080, 1920) and abs(float(probe(out)["format"]["duration"]) - 4.0) < 0.15
    from clipforge_worker.render.graph import build_command
    g = build_command(Path("s.mp4"), "o.mp4", edit(), [[0, 0.3, 0.4]], 1280, 720, 0.5, 4.5, None, "a.ass", "libx264", wide=[[1.0, 2.5], [9, 10]])
    g = g[g.index("-filter_complex") + 1]
    assert "boxblur" in g and "enable='between(t,0.5,2)'" in g  # clip-relative, and only the wide shot inside the clip


def test_hand_framed_shot_and_speaker_colours_reach_the_export(conn, data_dir, clips, monkeypatch):
    from clipforge_worker.stages import render as R
    pid = project(conn, data_dir, clips)
    md = data_dir / "media" / pid
    (md / "track.json").write_text(json.dumps({"keyframes": [[0, 0.3, 0.4]], "wide": [[1.0, 2.5]]}))
    words = [{**w, "speaker": i % 2} for i, w in enumerate(WORDS)]
    (md / "transcript.json").write_text(json.dumps({"language": "en", "words": words}))
    conn.execute("UPDATE Project SET speakers=? WHERE id=?", (json.dumps([{"name": "Asha", "color": "#112233"}]), pid))
    cid = add_clip(conn, pid, edit(focus=[[1.0, 2.5, 0.8, 0.5]], speakerColors=True))
    seen = {}
    real_cmd, real_ass = R.build_command, R.build_ass
    monkeypatch.setattr(R, "build_command", lambda *a, **k: (seen.update(kf=a[3], wide=k["wide"]), real_cmd(*a, **k))[1])
    monkeypatch.setattr(R, "build_ass", lambda i: (seen.update(ass=real_ass(i)), seen["ass"])[1])
    assert render(conn, pid, [cid])["status"] == "done"
    assert seen["wide"] == []                                     # the framed shot is cropped, not shown whole
    from clipforge_worker.clips.reframe import center_at
    assert center_at(seen["kf"], 1.5) == (0.8, 0.5) and center_at(seen["kf"], 0.5) == (0.3, 0.4) and center_at(seen["kf"], 3) == (0.3, 0.4)
    assert "\\1c&H332211&" in seen["ass"] and "\\1c&HF28D5B&" in seen["ass"]  # speaker 0 as picked, speaker 1 the default blue
