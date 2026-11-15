"""Plain-JSON persistence. No database for v1 - one manifest.json per job,
plus a single presets.json for saved subtitle styles. Good enough for a
single local user; revisit only if this actually becomes a bottleneck.
"""

import json
from pathlib import Path
from typing import Any

from clipforge.engine.app.config import JOBS_DIR, PRESETS_FILE


def job_dir(job_id: str) -> Path:
    d = JOBS_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def manifest_path(job_id: str) -> Path:
    return job_dir(job_id) / "manifest.json"


def read_manifest(job_id: str) -> dict[str, Any]:
    path = manifest_path(job_id)
    if not path.exists():
        raise FileNotFoundError(f"No manifest for job {job_id}")
    return json.loads(path.read_text())


def write_manifest(job_id: str, data: dict[str, Any]) -> None:
    manifest_path(job_id).write_text(json.dumps(data, indent=2))


def update_job_progress(job_id: str, pct: int) -> None:
    data = read_manifest(job_id)
    current_pct = data.get("job", {}).get("progress")
    if current_pct is None or pct >= current_pct + 2 or pct == 100:
        data["job"]["progress"] = pct
        write_manifest(job_id, data)


def list_job_ids() -> list[str]:
    if not JOBS_DIR.exists():
        return []
    return sorted(p.name for p in JOBS_DIR.iterdir() if p.is_dir())


def read_presets() -> list[dict[str, Any]]:
    if not PRESETS_FILE.exists():
        return []
    return json.loads(PRESETS_FILE.read_text())


def write_presets(presets: list[dict[str, Any]]) -> None:
    PRESETS_FILE.write_text(json.dumps(presets, indent=2))
