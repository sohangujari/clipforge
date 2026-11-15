"""Convert Devanagari-script Hindi words into casual romanized Hinglish
captions, preserving natural Hindi-English code-switching. Deliberately
uses the LLM rather than a transliteration library - Hinglish is colloquial
spelling convention, not formal transliteration, and a library won't handle
mid-sentence code-switching well.
"""

from clipforge.engine.app.models.schemas import WordTiming
from clipforge.engine.app.pipeline.glm_client import call_glm_json

SYSTEM_PROMPT = """You convert Hindi speech transcripts into Hinglish captions -
Hindi written in casual Roman/English script the way people text it, keeping
any English words that were already spoken as-is (natural code-switching).
Do not translate meaning to English - only romanize the Hindi parts.

Return ONLY a JSON object, no markdown fences, no preamble, in this exact shape:
{"words": ["word1", "word2", ...]}

The output words array MUST have exactly the same length as the input words
array, in the same order - one Hinglish word per input word, so timestamps
still line up."""


def to_hinglish(words: list[WordTiming]) -> list[WordTiming]:
    if not words:
        return []

    input_words = [w.word for w in words]
    result = call_glm_json(SYSTEM_PROMPT, str({"words": input_words}))

    hinglish_words = result.get("words", [])
    if len(hinglish_words) != len(words):
        # GLM didn't preserve word count - fall back to original rather than
        # risk misaligned timestamps. Worth logging when you wire up real logging.
        return words

    return [
        WordTiming(word=hw, start=w.start, end=w.end)
        for hw, w in zip(hinglish_words, words)
    ]
