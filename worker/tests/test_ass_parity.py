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
