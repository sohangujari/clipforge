import json

from clipforge_worker import chat, signals


def test_reads_twitchdownloader_youtube_and_plain_text_logs():
    td = {"comments": [{"content_offset_seconds": 12.5, "commenter": {"name": "amy"}, "message": {"body": "KEKW"}}]}
    assert chat.parse(json.dumps(td).encode()) == ([(12.5, "amy", "KEKW")], "twitch")
    yt = {"replayChatItemAction": {"videoOffsetTimeMsec": "61500", "actions": [{"addChatItemAction": {"item": {"liveChatTextMessageRenderer": {
        "authorName": {"simpleText": "bob"}, "message": {"runs": [{"text": "no way "}, {"emoji": {"shortcuts": [":fire:"]}}]}}}}}]}}
    assert chat.parse((json.dumps(yt) + "\n").encode()) == ([(61.5, "bob", "no way :fire:")], "youtube")
    txt = b"[0:01:02] cat: clip it\n1:00:00 <dan> lol\nnot a line\n"
    assert chat.parse(txt) == ([(62, "cat", "clip it"), (3600, "dan", "lol")], "file")


def test_unreadable_file_is_an_error():
    import pytest
    with pytest.raises(ValueError):
        chat.parse(b"hello world")


def test_bots_and_commands_are_dropped_and_messages_are_tagged():
    out = chat.pack([(5, "Nightbot", "Follow the stream!"), (3, "a", "!discord"), (4, "b", "LMAOOO"), (2, "c", "POGGERS"), (1, "d", "nice")], "twitch")
    assert out == {"source": "twitch", "t": [1, 2, 4], "k": [0, 2, 1]}
    assert chat.kind("hahaha that guy") == 1 and chat.kind("😂") == 1 and chat.kind("let's go") == 2 and chat.kind("hello there") == 0


def test_a_chat_burst_is_a_spike_shifted_back_by_the_chat_delay(tmp_path):
    t = [i * 2.0 for i in range(300)] + [100 + chat.DELAY_S + i * 0.05 for i in range(80)]  # steady chat, then a burst
    (tmp_path / "chat.json").write_text(json.dumps({"source": "twitch", "t": t, "k": [1] * len(t)}))
    sig = {"hop": signals.HOP, **chat.signal(tmp_path, signals.HOP, int(600 / signals.HOP))}
    (peak, z), = signals.peaks(sig, "chat", z_min=3)
    assert abs(peak - 102) < 4 and z > 3
    assert signals.segment_features(sig, 95, 110)["chat"] > 3 and signals.segment_features(sig, 300, 320)["chat"] < 1
    assert "chat" not in signals.segment_features({"hop": signals.HOP, "rms_db": [0.0] * 10}, 0, 2)  # no chat: no feature


def test_an_imported_file_becomes_chat_json(tmp_path):
    (tmp_path / "chat-import").write_bytes(b"0:00:05 a: W\n")
    chat.ensure(tmp_path)
    assert json.loads((tmp_path / "chat.json").read_text()) == {"source": "file", "t": [5], "k": [2]}
    assert not (tmp_path / "chat-import").exists()
