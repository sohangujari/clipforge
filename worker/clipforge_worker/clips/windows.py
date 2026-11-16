from dataclasses import dataclass

from .sentences import Sentence


def weight(s: Sentence) -> int:
    """Words, or UTF-8 bytes / 6 if larger: ≈ tokens for English and Hindi alike, so local windows fit a 4K context."""
    return max(s.n_words, len(s.text.encode()) // 6)


@dataclass
class Window:
    index: int
    sentences: list[Sentence]


def windows(sentences: list[Sentence], words_per_window: int, overlap_words: int) -> list[Window]:
    """Consecutive sentence windows of ~words_per_window words; neighbours share ≥ overlap_words words."""
    out, i, n = [], 0, len(sentences)
    while i < n:
        j, count = i, 0
        while j < n and (count < words_per_window or j == i):
            count += weight(sentences[j]); j += 1
        out.append(Window(len(out), sentences[i:j]))
        if j >= n:
            break
        k, back = j, 0  # step back from the end until the overlap is covered
        while k > i + 1 and back < overlap_words:
            k -= 1; back += weight(sentences[k])
        i = k
    return out
