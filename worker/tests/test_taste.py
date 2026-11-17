"""Real view counts: the best performers lead the kept examples, the worst the deleted ones."""
import json
import uuid

from clipforge_worker import db
from clipforge_worker.clips.taste import examples
from conftest import upload_project


def test_views_rank_examples_once_three_clips_have_them(conn, data_dir, clips):
    pid, _ = upload_project(conn, data_dir, clips["with_audio"])
    conn.execute("INSERT INTO ClipFeedback (id, contentType, action, summary, createdAt) VALUES (?,?,?,?,?)", (str(uuid.uuid4()), "podcast", "kept", "“K” — kept", db.now_iso()))

    def clip(title, views):
        conn.execute("INSERT INTO Clip (id, projectId, startSec, endSec, score, breakdown, reason, tips, titles, descriptions, hashtags, signals, views, createdAt) "
                     "VALUES (?,?,0,30,50,'{}',?,'[]',?,'{}','[]','{}',?,?)", (str(uuid.uuid4()), pid, f"why {title}", json.dumps([title]), views, db.now_iso()))
    clip("Hit", 1_250_000)
    clip("Flop", 90)
    assert examples(conn, "podcast")["kept"] == ["“K” — kept"]  # two clips with views: not enough to tell
    clip("Okay", 4_000)
    e = examples(conn, "podcast")
    assert e["kept"] == ["(1.2M real views) “Hit” — why Hit", "“K” — kept"]
    assert e["deleted"] == ["(90 real views) “Flop” — why Flop"]
