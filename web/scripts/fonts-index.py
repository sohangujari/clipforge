"""Writes web/public/fonts/fonts.json: for every bundled TTF, the family name libass matches on and whether it's the
Bold style. Run after adding fonts: uv run --with fonttools python web/scripts/fonts-index.py
Both subtitle generators (web/lib/ass.ts, worker render/ass.py) read this file, so preview and export pick the same file."""
import json
from pathlib import Path

from fontTools.ttLib import TTFont

DIR = Path(__file__).resolve().parent.parent / "public" / "fonts"
ALIASES = {"montserrat": "Montserrat", "anton": "Anton", "inter": "Inter", "poppins": "Poppins", "courier-prime": "Courier Prime",
           "bebas-neue": "Bebas Neue", "geist": "Geist", "noto-sans-devanagari": "Noto Sans Devanagari"}

out = []
for f in sorted(DIR.glob("*.ttf")):
    stem, weight = f.stem.rsplit("-", 1)
    name = TTFont(f)["name"]
    out.append({"family": ALIASES[stem], "weight": int(weight), "file": f.name,
                "assName": name.getDebugName(1), "bold": name.getDebugName(2) in ("Bold", "Bold Italic")})
(DIR / "fonts.json").write_text(json.dumps(out, indent=2) + "\n")
print(f"{len(out)} fonts")
