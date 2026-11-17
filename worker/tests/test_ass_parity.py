"""The export's subtitle generator must produce byte-identical ASS to the editor preview's (web/lib/ass.ts)."""
import json
from pathlib import Path

import pytest

from clipforge_worker.render.ass import build_ass

FIX = Path(__file__).resolve().parents[2] / "shared" / "ass-fixtures"
CASES = sorted(FIX.glob("*.input.json"))


def test_fixtures_exist():
    assert len(CASES) >= 12


@pytest.mark.parametrize("case", CASES, ids=lambda p: p.name.removesuffix(".input.json"))
def test_every_fixture_matches_the_ts_generator(case):
    expected = case.with_name(case.name.replace(".input.json", ".ass")).read_text()
    assert build_ass(json.loads(case.read_text())) == expected


def test_cut_retiming_and_zoom_match_the_editor():
    from clipforge_worker.render.cuts import retime_words, zoom_at, zoom_expr
    f = json.loads((FIX.parent / "cuts-fixture.json").read_text())
    assert retime_words(f["words"], f["keep"]) == f["retimed"]
    for t, z in f["zoomSamples"]:
        assert zoom_at(f["zooms"], t) == pytest.approx(z, abs=1e-9)
    # the FFmpeg expression is the same curve
    expr = zoom_expr(f["zooms"], "it")
    for t, z in f["zoomSamples"]:
        assert eval(expr.replace("clip(", "_clip("), {"_clip": lambda v, lo, hi: min(hi, max(lo, v)), "it": t}) == pytest.approx(z, abs=1e-9)
    assert zoom_expr([]) == "1"
    from clipforge_worker.render.cuts import middle_ranges
    assert middle_ranges([[9, 12, 2], [13.2, 14.9, 3], [16, 30, 2]], f["keep"], True) == f["middle"]
    assert middle_ranges([[9, 12, 2]], f["keep"], False) == []


def test_hand_framing_and_speaker_words_match_the_editor():
    from clipforge_worker.clips.reframe import apply_focus, minus_focus
    from clipforge_worker.render.cuts import retime_words
    f = json.loads((FIX.parent / "cuts-fixture.json").read_text())
    c = f["focus"]
    assert [pytest.approx(k, abs=1e-9) for k in c["out"]] == apply_focus(c["kf"], c["focus"])
    assert minus_focus(c["wide"], c["focus"]) == c["wideOut"]
    assert apply_focus(c["kf"], []) == c["kf"]
    talk = [{**w, "speaker": i % 2} for i, w in enumerate(f["words"])]
    assert retime_words(talk, f["keep"]) == f["retimedSpeakers"]


def test_gaming_regions_match_the_editor():
    """Facecam top/bottom, PiP, gameplay only and reaction stack: the export crops and places exactly what the preview draws."""
    from clipforge_worker.clips.gaming import regions
    f = json.loads((FIX.parent / "cuts-fixture.json").read_text())
    assert len(f["gaming"]) == 60
    for c in f["gaming"]:
        assert regions(c["layout"], c["o"], *c["src"], *c["out"]) == c["regions"], c
