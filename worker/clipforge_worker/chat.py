"""Stream chat as a clip-finding signal: download it with the stream link (Twitch, YouTube), or read an imported chat file;
keep only real viewers' messages (no bots or !commands), tag laughing and hype messages, and turn them into per-frame
message rates that analyze compares with the stream's own baseline (signals.robust_z).

media/<id>/chat.json = {"source", "t": [seconds], "k": [0 plain | 1 laughing | 2 hype]}. Never fails a job."""
import json
import logging
import os
import re
import time
import urllib.request

import numpy as np

from .errors import Cancelled

log = logging.getLogger("clipforge.worker")

DELAY_S = 5.0      # chat reacts a few seconds after the moment (stream delay + typing): shift it back
WINDOW_S = 6.0     # messages per second over a 6 s window
BOTS = {"nightbot", "streamelements", "moobot", "fossabot", "streamlabs", "wizebot", "sery_bot", "soundalerts", "botisimo",
        "kofistreambot", "pokemoncommunitygame", "commanderroot", "own3d", "blerp", "streamstickers", "frostytoolsdotcom"}
FUNNY = {"lul", "lulw", "lol", "lmao", "lmfao", "kekw", "kek", "omegalul", "icant", "xd", "xdd", "pepelaugh", "jajaja", "rofl",
         "😂", "🤣", "💀", ":face-with-tears-of-joy:", ":rolling-on-the-floor-laughing:", ":skull:"}
HYPE = {"pog", "pogchamp", "poggers", "pogu", "w", "ww", "www", "clip", "clipit", "🔥", "gg", "ez", "holy", "insane", "letsgo",
        "omg", "wtf", "sheesh", "goat", "clutch", "hype", "monkas", ":fire:"}
TOKEN = re.compile(r":[a-z-]+:|[\U0001F300-\U0001FAFF]|[\w']+", re.UNICODE)


def kind(text: str) -> int:
    toks = [t.lower().strip("'") for t in TOKEN.findall(text)]
    if any(t in FUNNY or t.startswith("haha") or t.startswith("lmao") for t in toks):
        return 1
    if any(t in HYPE for t in toks) or "clip it" in text.lower() or "let's go" in text.lower():
        return 2
    return 0


def keep_message(user: str, text: str) -> bool:
    return bool(text.strip()) and not text.lstrip().startswith("!") and user.lower() not in BOTS


def pack(msgs, source: str) -> dict:
    """[(t, user, text)] → the chat.json shape, time-sorted, bots and commands dropped."""
    rows = sorted((round(float(t), 2), kind(x)) for t, u, x in msgs if t is not None and t >= 0 and keep_message(u or "", x or ""))
    return {"source": source, "t": [r[0] for r in rows], "k": [r[1] for r in rows]}


# ---- Parsers: TwitchDownloader JSON, yt-dlp's YouTube live_chat.json (JSON lines), plain-text logs.

_LINE = re.compile(r"^\s*\[?(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?\]?\s+<?([^\s:>]+)>?:?\s+(.*)$")


def _yt_line(obj: dict):
    r = obj.get("replayChatItemAction") or {}
    ms = r.get("videoOffsetTimeMsec")
    for a in r.get("actions") or []:
        item = ((a.get("addChatItemAction") or {}).get("item") or {})
        m = item.get("liveChatTextMessageRenderer") or item.get("liveChatPaidMessageRenderer")
        if m and ms is not None:
            text = "".join(run.get("text") or " ".join(((run.get("emoji") or {}).get("shortcuts") or [""])[:1]) for run in (m.get("message") or {}).get("runs") or [])
            yield int(ms) / 1000, (m.get("authorName") or {}).get("simpleText", ""), text


def parse(raw: bytes) -> tuple[list, str]:
    """Any supported chat file → ([(t, user, text)], source). Raises ValueError for something else."""
    text = raw.decode("utf-8", errors="replace").lstrip("﻿")
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        doc = None
    if isinstance(doc, dict) and isinstance(doc.get("comments"), list):  # TwitchDownloader
        return [(c.get("content_offset_seconds"), (c.get("commenter") or {}).get("name", ""), (c.get("message") or {}).get("body", ""))
                for c in doc["comments"]], "twitch"
    msgs, src = [], None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("{"):
            try:
                msgs.extend(_yt_line(json.loads(line)))
                src = "youtube"
                continue
            except json.JSONDecodeError:
                pass
        if m := _LINE.match(line):
            h, mi, s, user, body = m.groups()
            msgs.append((int(h or 0) * 3600 + int(mi) * 60 + int(s), user, body))
            src = src or "file"
    if not msgs:
        raise ValueError("not a chat log ClipForge can read")
    return msgs, src or "file"


# ---- Downloads.

TWITCH_GQL = "https://gql.twitch.tv/gql"
TWITCH_CLIENT = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp"  # the public web client id TwitchDownloader uses; no account needed
TWITCH_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"  # VideoCommentsByOffsetOrCursor
MAX_PAGES = 50_000  # ~5 M messages: far beyond any VOD


def _gql(variables: dict) -> dict:
    body = {"operationName": "VideoCommentsByOffsetOrCursor", "variables": variables,
            "extensions": {"persistedQuery": {"version": 1, "sha256Hash": TWITCH_HASH}}}
    req = urllib.request.Request(TWITCH_GQL, json.dumps(body).encode(), {"Client-Id": TWITCH_CLIENT, "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    return {}


def twitch(video_id: str, duration: float, report) -> list:
    """Twitch's own (undocumented) chat replay API, page by page. Twitch can change it at any time: callers treat any
    error as 'no chat'."""
    msgs, variables = [], {"videoID": video_id, "contentOffsetSeconds": 0}
    for _ in range(MAX_PAGES):
        out = _gql(variables)
        comments = (((out.get("data") or {}).get("video") or {}).get("comments")) if isinstance(out, dict) else None
        if not comments:
            raise ValueError(f"Twitch chat replay unavailable: {str(out)[:200]}")
        edges = comments.get("edges") or []
        for e in edges:
            n = e.get("node") or {}
            text = "".join(f.get("text") or "" for f in (n.get("message") or {}).get("fragments") or [])
            msgs.append((n.get("contentOffsetSeconds"), (n.get("commenter") or {}).get("login", ""), text))
        if edges and duration:
            report(min(0.99, (edges[-1]["node"].get("contentOffsetSeconds") or 0) / duration))
        if not edges or not (comments.get("pageInfo") or {}).get("hasNextPage"):
            break
        variables = {"videoID": video_id, "cursor": edges[-1]["cursor"]}
    return msgs


def youtube(url: str, md) -> list:
    """YouTube's chat replay through yt-dlp (live_chat 'subtitles'); [] for videos that were never live."""
    import yt_dlp
    opts = {"skip_download": True, "writesubtitles": True, "subtitleslangs": ["live_chat"], "quiet": True, "no_warnings": True,
            "noprogress": True, "outtmpl": str(md / "chat-dl.%(ext)s")}
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    f = next(md.glob("chat-dl*.json"), None)
    if not f:
        return []
    try:
        return parse(f.read_bytes())[0]
    finally:
        f.unlink(missing_ok=True)


def _write(md, data: dict) -> None:
    tmp = md / "chat.tmp"
    tmp.write_text(json.dumps(data))
    os.replace(tmp, md / "chat.json")


def ensure(md) -> None:
    """An imported chat file (web: POST /api/projects/<id>/chat → media/<id>/chat-import) becomes chat.json."""
    f = md / "chat-import"
    if not f.exists():
        return
    try:
        msgs, src = parse(f.read_bytes())
        _write(md, pack(msgs, src))
    except ValueError as e:
        log.warning("chat import skipped: %s", e)
    f.unlink(missing_ok=True)


def run(ctx) -> None:
    """Ingest stage, after the download: fetch the stream's chat. Best effort — no chat just means one signal fewer."""
    md, url = ctx.media_dir, ctx.project.get("sourceUrl") or ""
    info_f = md / "source.json"
    if ctx.project["sourceType"] != "url" or (md / "chat.json").exists() or (md / "chat.none").exists() or not info_f.exists():
        ctx.report(1.0)
        return
    info = json.loads(info_f.read_text())
    ctx.report(0.0, "Downloading chat")
    try:
        if info.get("extractor", "").lower().startswith("twitch") and info.get("id"):
            msgs = twitch(str(info["id"]).lstrip("v"), float(info.get("duration") or 0), lambda f: ctx.report(f, "Downloading chat"))
            source = "twitch"
        elif info.get("extractor", "").lower().startswith("youtube") and info.get("live"):
            msgs, source = youtube(url, md), "youtube"
        else:
            msgs, source = [], ""
    except Cancelled:
        raise
    except Exception as e:  # noqa: BLE001 — undocumented API, network, yt-dlp: none of it may fail the import
        log.warning("chat download skipped: %s", e)
        msgs, source = [], ""
    if msgs:
        _write(md, pack(msgs, source))
    else:
        (md / "chat.none").touch()
    ctx.report(1.0)


def signal(md, hop: float, n: int) -> dict:
    """Per-frame message rates (all, laughing, hype) on the signals.json clock; {} without chat."""
    f = md / "chat.json"
    if not f.exists() or n <= 0:
        return {}
    c = json.loads(f.read_text())
    t, k = np.asarray(c.get("t") or [], np.float64) - DELAY_S, np.asarray(c.get("k") or [], np.int8)
    if not t.size:
        return {}
    edges = np.arange(n + 1) * hop
    win = np.ones(max(1, round(WINDOW_S / hop))) / WINDOW_S
    rate = lambda sel: [round(float(v), 3) for v in np.convolve(np.histogram(t[sel], edges)[0], win, "same")]  # noqa: E731
    return {"chat": rate(np.ones_like(k, bool)), "chat_funny": rate(k == 1), "chat_hype": rate(k == 2)}
