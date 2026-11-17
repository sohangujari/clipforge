"""Taste learning: the creator's recent keeps/deletes become few-shot examples in the highlight prompt. Clips with real
view counts typed in count most: the best performers lead the "kept" examples, the worst lead the "deleted" ones."""
import json

MIN_VIEWED = 3  # with fewer clips that have views there's no best and worst yet


def _views(n: int) -> str:
    return f"{n / 1e6:.1f}M" if n >= 1e6 else f"{n / 1e3:.1f}K" if n >= 1e3 else str(n)


def performers(conn, k: int) -> tuple[list[str], list[str]]:
    rows = conn.execute("SELECT titles, reason, views FROM Clip WHERE views IS NOT NULL ORDER BY views DESC LIMIT 200").fetchall()
    if len(rows) < MIN_VIEWED:
        return [], []
    k = min(k, len(rows) // 3 or 1)
    line = lambda r: f"({_views(r[2])} real views) “{json.loads(r[0])[0]}” — {r[1]}"  # noqa: E731
    return [line(r) for r in rows[:k]], [line(r) for r in rows[::-1][:k]]


def examples(conn, content_type: str, n: int = 6, chars: int = 400) -> dict:
    def pick(action: str) -> list[str]:
        rows = conn.execute("SELECT summary FROM ClipFeedback WHERE action=? AND contentType=? ORDER BY createdAt DESC LIMIT ?",
                            (action, content_type, n)).fetchall()
        if not rows:  # fall back to any type rather than nothing
            rows = conn.execute("SELECT summary FROM ClipFeedback WHERE action=? ORDER BY createdAt DESC LIMIT ?", (action, n)).fetchall()
        return [r[0] for r in rows]
    best, worst = performers(conn, max(1, n // 3))
    return {"kept": [s[:chars] for s in (best + pick("kept"))[:n]], "deleted": [s[:chars] for s in (worst + pick("deleted"))[:n]]}
