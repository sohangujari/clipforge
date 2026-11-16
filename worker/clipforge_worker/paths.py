import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    """Same default as web/lib/paths.ts: <repo>/data, overridable with CLIPFORGE_DATA_DIR."""
    return Path(os.environ.get("CLIPFORGE_DATA_DIR") or REPO / "data").resolve()


def media_dir(project_id: str) -> Path:
    d = data_dir() / "media" / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d
