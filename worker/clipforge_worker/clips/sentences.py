import re
from dataclasses import dataclass

END = re.compile(r"[.?!…]['\")\]]*$")
PAUSE_S = 0.7


@dataclass
class Sentence:
    id: int
    start: float
    end: float
    text: str
    first_word: int
    last_word: int

    @property
    def n_words(self) -> int:
        return self.last_word - self.first_word + 1


def split_sentences(words: list[dict], max_words: int = 40) -> list[Sentence]:
    """Sentences from word timings: end on . ? ! …, at pauses over 0.7 s, or — for run-ons — at the
    largest internal pause once max_words is reached."""
    out: list[Sentence] = []
    cur: list[int] = []  # word indices

    def close(idx: list[int]) -> None:
        out.append(Sentence(len(out), words[idx[0]]["s"], words[idx[-1]]["e"], " ".join(words[i]["w"] for i in idx), idx[0], idx[-1]))

    for i, w in enumerate(words):
        if cur and w["s"] - words[cur[-1]]["e"] > PAUSE_S:
            close(cur); cur = []
        cur.append(i)
        if END.search(w["w"]):
            close(cur); cur = []
        elif len(cur) >= max_words:
            # cut at the largest pause in the second half; ties go to the later word (no one-word fragments)
            k = max(range(len(cur) // 2, len(cur)), key=lambda j: (words[cur[j]]["s"] - words[cur[j - 1]]["e"], j))
            close(cur[:k]); cur = cur[k:]
    if cur:
        close(cur)
    return out
