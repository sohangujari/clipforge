from clipforge_worker.clips.scoring import fuse

DIMS = {"hook": 80, "emotion": 60, "value": 70, "pacing": 70, "trend": 50, "extra": {}}


def test_weighted_average_without_signals():
    overall, b = fuse(DIMS, {}, "custom")
    assert 60 < overall < 75
    assert b["signals_used"] == []


def test_laughter_boosts_emotion_and_is_reported():
    base, _ = fuse(DIMS, {"laughter": 0.0}, "podcast")
    boosted, b = fuse(DIMS, {"laughter": 6.0, "energy": 4.0}, "podcast")
    assert boosted > base
    assert b["emotion"] > DIMS["emotion"]
    assert "laughter" in b["signals_used"]


def test_extras_count_for_their_type():
    gaming = {**DIMS, "extra": {"reaction": 95, "action": 95}}
    hi, _ = fuse(gaming, {}, "gaming")
    lo, _ = fuse({**DIMS, "extra": {"reaction": 10, "action": 10}}, {}, "gaming")
    assert hi - lo > 10


def test_clamped_0_100():
    top = {"hook": 100, "emotion": 100, "value": 100, "pacing": 100, "trend": 100, "extra": {}}
    o, _ = fuse(top, {"laughter": 50, "energy": 50}, "custom")
    assert o <= 100
