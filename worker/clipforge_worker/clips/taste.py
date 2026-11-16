"""Taste learning: the creator's recent keeps/deletes become few-shot examples in the highlight prompt."""


def examples(conn, content_type: str, n: int = 6, chars: int = 400) -> dict:
    def pick(action: str) -> list[str]:
        rows = conn.execute("SELECT summary FROM ClipFeedback WHERE action=? AND contentType=? ORDER BY createdAt DESC LIMIT ?",
                            (action, content_type, n)).fetchall()
        if not rows:  # fall back to any type rather than nothing
            rows = conn.execute("SELECT summary FROM ClipFeedback WHERE action=? ORDER BY createdAt DESC LIMIT ?", (action, n)).fetchall()
        return [r[0][:chars] for r in rows]
    return {"kept": pick("kept"), "deleted": pick("deleted")}
