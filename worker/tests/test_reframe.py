"""Face track → a calm crop: holds still through jitter and dropouts, pans only when the speaker really moves."""
import json

from clipforge_worker.clips.reframe import center_at, crop_rect, smooth_track
from clipforge_worker.stages import faces as F
from conftest import ctx_for, upload_project

FPS = 2


def face(cx, cy=0.4):
    return [cx, cy, 0.1, 0.2, 0.9]


def test_no_faces_gives_a_single_centre_keyframe():
    assert smooth_track([None] * 40, FPS) == [(0.0, 0.5, 0.5)]
    assert smooth_track([], FPS) == [(0.0, 0.5, 0.5)]


def test_small_jitter_inside_the_dead_zone_never_moves():
    k = smooth_track([face(0.50 if i % 2 else 0.52) for i in range(120)], FPS)
    assert len(k) == 1


def test_speaker_moving_to_the_right_pans_and_settles():
    k = smooth_track([face(0.3)] * 20 + [face(0.7)] * 40, FPS)
    assert abs(k[0][1] - 0.3) < 0.01 and abs(k[-1][1] - 0.7) < 0.03
    assert [t for t, *_ in k] == sorted(t for t, *_ in k)
    assert 2 <= len(k) <= 6
    starts = [k[i][0] for i in range(1, len(k), 2)]  # each move = (pan start, pan end)
    assert all(b - a >= 1.0 for a, b in zip(starts, starts[1:]))


def test_short_dropouts_keep_the_last_position():
    k = smooth_track([face(0.3)] * 10 + [None] * 2 + [face(0.3)] * 10, FPS)
    assert k == [(0.0, 0.3, 0.4)]


def test_leading_dropout_uses_the_first_face_not_the_centre():
    assert smooth_track([None] * 4 + [face(0.8)] * 10, FPS) == [(0.0, 0.8, 0.4)]


def test_center_at_interpolates_and_clamps():
    k = [(0, 0.2, 0.5), (2, 0.8, 0.5)]
    assert center_at(k, 1) == (0.5, 0.5)
    assert center_at(k, -1) == (0.2, 0.5)
    assert center_at(k, 5) == (0.8, 0.5)


def test_crop_rect_9x16_on_landscape_is_even_and_clamped():
    assert crop_rect(0.0, 0.5, 1920, 1080, 9 / 16) == (0, 0, 606, 1080)
    assert crop_rect(1.0, 0.5, 1920, 1080, 9 / 16) == (1314, 0, 606, 1080)
    assert crop_rect(0.5, 0.5, 1920, 1080, 1) == (420, 0, 1080, 1080)


def test_portrait_or_matching_source_needs_no_crop():
    assert crop_rect(0.5, 0.5, 1080, 1920, 9 / 16) == (0, 0, 1080, 1920)
    assert crop_rect(0.3, 0.5, 1920, 1080, 16 / 9) == (0, 0, 1920, 1080)


def test_faces_stage_skips_when_track_exists(conn, data_dir, clips):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    track = data_dir / "media" / pid / "track.json"
    track.write_text(json.dumps({"keyframes": [[0, 0.1, 0.2]]}))
    F.run(ctx_for(conn))
    assert json.loads(track.read_text()) == {"keyframes": [[0, 0.1, 0.2]]}


def test_video_without_faces_runs_mediapipe_and_centres(conn, data_dir, clips):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    md = data_dir / "media" / pid
    __import__("shutil").copy(clips["long_proxy"], md / "proxy.mp4")  # 120 s test pattern: no faces
    conn.execute("UPDATE Project SET durationSec=120 WHERE id=?", (pid,))
    F.run(ctx_for(conn))
    faces = json.loads((md / "faces.json").read_text())
    assert faces["fps"] == 2 and 235 <= len(faces["frames"]) <= 242 and not any(faces["frames"])
    track = json.loads((md / "track.json").read_text())
    assert track["keyframes"] == [[0.0, 0.5, 0.5]]
    assert len(track["wide"]) == 1 and track["wide"][0][0] == 0 and track["wide"][0][1] >= 117  # no face anywhere: whole-frame view


def test_camera_cut_jumps_instantly_instead_of_panning():
    k = smooth_track([face(0.3)] * 20 + [face(0.7)] * 20, FPS, cuts=[10.0])
    assert (10.0, 0.3, 0.4) in k and (10.001, 0.7, 0.4) in k  # the crop jumps at the cut, to the new shot's face exactly
    assert all(not (9.0 < t < 10.0) for t, *_ in k)            # no early pan before the cut
    assert center_at(k, 9.99)[0] == 0.3 and center_at(k, 10.01)[0] == 0.7


def test_cut_into_a_shot_without_a_face_centres_the_crop():
    # A wide shot whose faces are too small to find: the last shot's face position means nothing in it.
    k = smooth_track([face(0.3)] * 20 + [None] * 20, FPS, cuts=[10.0])
    assert center_at(k, 9.9) == (0.3, 0.4) and center_at(k, 10.1) == (0.5, 0.5)


def test_a_talking_head_that_sways_does_not_keep_panning():
    import math
    # head and body move ±0.06 of the frame over a few seconds, as people do while talking: the crop should hold
    k = smooth_track([face(0.5 + 0.06 * math.sin(i / 4)) for i in range(120)], FPS)
    assert len(k) == 1


def test_cuts_are_found_at_the_right_frame(tmp_path):
    import subprocess
    v = tmp_path / "cut.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=0x202020:s=320x180:d=2:r=25", "-f", "lavfi", "-i", "color=0x707070:s=320x180:d=2:r=25",
                    "-filter_complex", "[0][1]concat=n=2:v=1", "-pix_fmt", "yuv420p", str(v)], check=True)
    cuts = F.find_cuts(v)
    assert len(cuts) == 1 and abs(cuts[0] - 2.0) <= 0.04


def test_face_detection_failure_never_fails_the_job(conn, data_dir, clips, monkeypatch):
    import urllib.error
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    md = data_dir / "media" / pid
    __import__("shutil").copy(clips["long_proxy"], md / "proxy.mp4")

    def offline(_):
        raise urllib.error.URLError("offline")
    monkeypatch.setattr(F, "_model", offline)
    F.run(ctx_for(conn))  # no exception: the crop just stays centred
    assert not (md / "track.json").exists()  # not cached, so a later run retries


def test_crop_rect_scale_matches_the_editor():  # web/tests/reframe.test.ts
    assert crop_rect(0.3, 0.4, 1920, 1080, 9 / 8, 0.5) == (272, 162, 606, 540)
    assert crop_rect(0.95, 0.5, 1920, 1080, 9 / 8, 0.45) == (1374, 296, 546, 486)


def test_cuts_are_found_in_a_very_dark_video(tmp_path):
    """A black-background studio: brightness ~3/255, so the frames barely differ in level; the picture changes completely."""
    import subprocess
    v = tmp_path / "dark.mp4"
    dark = "eq=brightness=-0.47:contrast=0.3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=2:r=25", "-f", "lavfi", "-i", "smptehdbars=s=320x180:d=2:r=25",
                    "-filter_complex", f"[0]{dark}[a];[1]{dark}[b];[a][b]concat=n=2:v=1", "-pix_fmt", "yuv420p", str(v)], check=True)
    cuts = F.find_cuts(v)
    assert len(cuts) == 1 and abs(cuts[0] - 2.0) <= 0.04


def test_shots_with_no_face_at_all_are_listed_for_a_full_frame_view():
    from clipforge_worker.clips.reframe import faceless_shots
    every = [[]] * 6 + [[face(0.3)]] * 10 + [[]] * 10 + [[]] * 4  # wide (0–3 s), close-up, wide (8–13 s), 2 s tail
    assert faceless_shots(every, FPS, cuts=[3.0, 8.0, 13.0]) == [[0.0, 3.0], [8.0, 15.0]]  # back-to-back faceless shots merge
    assert faceless_shots([[face(0.3)]] * 4 + [[]] + [[face(0.3)]] * 4, FPS, cuts=[]) == []  # a dropout inside a shot isn't a wide shot
