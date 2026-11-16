import threading
import time

import pytest

from clipforge_worker.errors import UserError
from clipforge_worker.stages import transcribe as T


def test_cached_means_weights_not_just_config(monkeypatch):
    present = {"config.json"}
    monkeypatch.setattr(T, "_cached_file", lambda repo, name: name in present)
    assert T.model_cached("r") is False          # a broken first download left only config.json
    present.add("weights.safetensors")
    assert T.model_cached("r") is True
    present.discard("weights.safetensors"); present.add("weights.npz")
    assert T.model_cached("r") is True


def test_download_reports_megabytes_and_progress(tmp_path, monkeypatch):
    blobs = tmp_path / "blobs"
    blobs.mkdir()
    monkeypatch.setattr(T, "model_cached", lambda repo: False)
    monkeypatch.setattr(T, "_cache_dir", lambda repo: tmp_path)
    monkeypatch.setattr(T, "_repo_size", lambda repo: 4_000_000)

    def fake_snapshot(repo):
        f = blobs / "w.incomplete"
        for _ in range(4):
            with open(f, "ab") as fh:
                fh.write(b"x" * 1_000_000)
            time.sleep(0.3)
    monkeypatch.setattr(T, "_snapshot", fake_snapshot)
    reports = []
    T.ensure_model("r", lambda f, msg=None: reports.append((f, msg)), poll_s=0.1)
    fractions = [f for f, _ in reports]
    assert fractions == sorted(fractions) and fractions[-1] == 1.0
    assert any(m and "MB of 4 MB" in m for _, m in reports)
    assert all("one-time" in m for _, m in reports if m)


def test_download_failure_is_user_error(tmp_path, monkeypatch):
    monkeypatch.setattr(T, "model_cached", lambda repo: False)
    monkeypatch.setattr(T, "_cache_dir", lambda repo: tmp_path)
    monkeypatch.setattr(T, "_repo_size", lambda repo: 1000)
    def boom(repo):
        raise OSError("connection reset")
    monkeypatch.setattr(T, "_snapshot", boom)
    with pytest.raises(UserError, match="Couldn't download the speech model"):
        T.ensure_model("r", lambda f, msg=None: None, poll_s=0.05)


def test_no_download_when_cached(monkeypatch):
    monkeypatch.setattr(T, "model_cached", lambda repo: True)
    monkeypatch.setattr(T, "_snapshot", lambda repo: pytest.fail("should not download"))
    T.ensure_model("r", lambda f, msg=None: None)


def test_progress_ignores_stale_partial_files(tmp_path, monkeypatch):
    blobs = tmp_path / "blobs"
    blobs.mkdir()
    (blobs / "old1.incomplete").write_bytes(b"x" * 1_500_000)  # leftovers from broken earlier attempts
    (blobs / "old2.incomplete").write_bytes(b"x" * 1_200_000)
    monkeypatch.setattr(T, "model_cached", lambda repo: False)
    monkeypatch.setattr(T, "_cache_dir", lambda repo: tmp_path)
    monkeypatch.setattr(T, "_repo_size", lambda repo: 2_000_000)

    def fake_snapshot(repo):
        f = blobs / "new.incomplete"
        for _ in range(4):
            with open(f, "ab") as fh:
                fh.write(b"x" * 500_000)
            time.sleep(0.25)
    monkeypatch.setattr(T, "_snapshot", fake_snapshot)
    msgs = []
    T.ensure_model("r", lambda f, msg=None: msgs.append((f, msg)), poll_s=0.1)
    shown = [int(m.split("· ")[1].split(" MB")[0]) for _, m in msgs if m and "MB of" in m]
    assert shown and max(shown) <= 2
