"""Who's on screen, whose voice is whose, and the crop paths for the speaker layouts (clips/people.py)."""
from clipforge_worker.clips.people import Speech, build, label_words, map_voices, renumber, shot_people
from clipforge_worker.clips.reframe import center_at

L, R = [0.3, 0.4, 0.1, 0.18], [0.7, 0.42, 0.1, 0.18]  # two people side by side (cx, cy, w, h)


def mouth(t0, t1, talker, fps=8):
    """The talker's jaw moves; the other's stays still."""
    out, n = [], 0
    while t0 + n / fps < t1:
        out.append((t0 + n / fps, [(0.3, 0.5 if talker == "L" and n % 2 else 0.1), (0.7, 0.5 if talker == "R" and n % 2 else 0.1)]))
        n += 1
    return out


def test_renumber_orders_voices_by_talk_time_and_drops_stray_clusters():
    assert renumber([(0, 2, 7), (2, 10, 3), (10, 11, 9), (11, 13, 7)]) == [(0, 2, 1), (2, 10, 0), (11, 13, 1)]


def test_words_get_the_voice_heard_most_during_them():
    words = [{"w": "a", "s": 0, "e": 1}, {"w": "b", "s": 1.8, "e": 2.6}, {"w": "c", "s": 50, "e": 51}]
    label_words(words, Speech([(0, 2, 0), (2, 5, 1)]))
    assert [w.get("speaker") for w in words] == [0, 1, None]


def test_people_are_grouped_by_position_and_must_persist():
    every = [[L, R] for _ in range(20)] + [[L, R, [0.95, 0.9, 0.05, 0.05]]]  # a false face in one frame
    people = shot_people(every, 2, 0, 10.5)
    assert [round(p["x"], 1) for p in people] == [0.3, 0.7]


def test_each_voice_goes_to_the_face_whose_mouth_moves():
    people = shot_people([[L, R]] * 20, 2, 0, 10)
    speech = Speech([(0, 5, 0), (5, 10, 1)])
    assert map_voices(people, mouth(0, 5, "R") + mouth(5, 10, "L"), speech) == {1: 0, 0: 1}
    assert map_voices(people, mouth(0, 1, "R"), speech) == {}  # under 2 s of evidence: no guess


def test_active_speaker_cuts_to_the_talker_but_holds_each_shot_long_enough():
    every = [[L, R]] * 40  # 20 s wide shot
    speech = Speech([(0, 8, 0), (8, 8.6, 1), (8.6, 12, 0), (12, 20, 1)])  # a 0.6 s interjection at 8 s, a real turn at 12 s
    talker = lambda s, e: [x for a, b, w in ((0, 12, "L"), (12, 20, "R")) for x in mouth(max(a, s), min(b, e), w)]  # noqa: E731
    plan = build(20, [], every, 2, speech, talker, [[0, 0.5, 0.5]])
    xs = [round(center_at(plan["track"], t)[0], 1) for t in (2, 8.4, 11, 13.5, 18)]
    assert xs == [0.3, 0.3, 0.3, 0.7, 0.7]  # the interjection doesn't cut; the turn does, within ~1 s
    assert plan["multi"] and plan["split"]["ranges"] == [[0, 20, 2]]
    top, bottom = plan["split"]["tracks"]["2"]
    assert round(center_at(top, 5)[0], 1) == 0.3 and round(center_at(bottom, 5)[0], 1) == 0.7  # left person on top
    assert [r[3] for r in plan["grid"]["active"]] == [0, 1, 0, 1]  # grid outlines the talker's row


def test_single_person_shots_follow_that_face_and_have_no_rows():
    every = [[L]] * 10 + [[R]] * 10
    plan = build(10, [5], every, 2, Speech([]), lambda s, e: [], [[0, 0.5, 0.5]])
    assert not plan["multi"] and plan["split"]["ranges"] == [] and plan["faceH"] is None
    assert round(center_at(plan["track"], 2)[0], 1) == 0.3 and round(center_at(plan["track"], 7)[0], 1) == 0.7
