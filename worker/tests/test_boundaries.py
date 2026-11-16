import random

from clipforge_worker.clips.boundaries import PAD_END, PAD_START, dedupe, snap
from clipforge_worker.clips.sentences import split_sentences
from clipforge_worker.clips.windows import windows


def mk_words(spec):
    """spec: list of (text, start, end)."""
    return [{"w": w, "s": s, "e": e} for w, s, e in spec]


def uniform_sentences(n, dur=6.0, gap=0.5, words_per=6):
    """n sentences of `dur` seconds each, separated by `gap` pauses."""
    words, t = [], 0.0
    for i in range(n):
        step = dur / words_per
        for j in range(words_per):
            w = f"w{i}_{j}" + ("." if j == words_per - 1 else "")
            words.append({"w": w, "s": round(t, 2), "e": round(t + step - 0.05, 2)})
            t += step
        t += gap
    return split_sentences(words), t


def test_split_on_punctuation_and_pause():
    words = mk_words([("Hello", 0, .3), ("there.", .4, .8), ("How", .9, 1.1), ("are", 1.2, 1.4), ("you?", 1.5, 1.8),
                      ("ok", 3.0, 3.2), ("then", 3.3, 3.5)])  # 1.2 s pause before "ok"
    s = split_sentences(words)
    assert [x.text for x in s] == ["Hello there.", "How are you?", "ok then"]
    assert (s[1].start, s[1].end, s[1].first_word, s[1].last_word) == (.9, 1.8, 2, 4)


def test_long_run_on_splits_at_largest_internal_pause():
    words, t = [], 0.0
    for i in range(60):
        gap = 0.6 if i == 25 else 0.05
        words.append({"w": f"w{i}", "s": round(t, 2), "e": round(t + 0.2, 2)}); t += 0.2 + gap
    s = split_sentences(words, max_words=40)
    assert len(s) >= 2
    assert s[0].last_word == 25  # split after the largest pause, not blindly at 40


def test_windows_cover_everything_with_overlap():
    sents, _ = uniform_sentences(50, words_per=10)
    ws = windows(sents, words_per_window=100, overlap_words=20)
    covered = {x.id for w in ws for x in w.sentences}
    assert covered == {x.id for x in sents}
    for a, b in zip(ws, ws[1:]):
        shared = {x.id for x in a.sentences} & {x.id for x in b.sentences}
        assert sum(sents[i].last_word - sents[i].first_word + 1 for i in shared) >= 20


def test_whole_transcript_is_one_window_when_it_fits():
    sents, _ = uniform_sentences(20, words_per=10)
    assert len(windows(sents, words_per_window=25_000, overlap_words=500)) == 1


def test_snap_extends_short_candidate_to_minimum():
    sents, dur = uniform_sentences(30)
    a, b = snap(10, 10, sents, (30, 60), dur)
    assert 30 <= b - a <= 60 + PAD_START + PAD_END


def test_snap_trims_long_candidate_and_keeps_hook():
    sents, dur = uniform_sentences(30)
    a, b = snap(2, 20, sents, (15, 30), dur, hook_id=4)
    assert b - a <= 30 + PAD_START + PAD_END
    assert a <= sents[4].start - PAD_START + 1e-6 or abs(a - (sents[4].start - PAD_START)) < 0.02


def test_snap_never_starts_or_ends_mid_sentence():
    sents, dur = uniform_sentences(40)
    starts = {round(max(0, x.start - PAD_START), 2) for x in sents} | {round(x.start, 2) for x in sents}
    ends = {round(min(dur, x.end + PAD_END), 2) for x in sents} | {round(x.end, 2) for x in sents}
    rnd = random.Random(1)
    for _ in range(200):
        i = rnd.randrange(len(sents)); j = rnd.randrange(i, min(len(sents), i + 15))
        r = snap(i, j, sents, (15, 60), dur)
        if r is None:
            continue
        a, b = r
        assert any(abs(a - s) < 0.06 for s in starts), a
        assert any(abs(b - e) < 0.06 for e in ends), b


def test_snap_at_video_edges_clamps():
    sents, dur = uniform_sentences(12)
    a, _ = snap(0, 0, sents, (30, 60), dur)
    assert a == 0
    _, b = snap(11, 11, sents, (30, 60), dur)
    assert b <= dur


def test_snap_returns_none_for_single_overlong_sentence():
    words = [{"w": f"w{i}", "s": i * 1.0, "e": i * 1.0 + 0.9} for i in range(39)] + [{"w": "end.", "s": 39.0, "e": 39.9}]
    sents = split_sentences(words, max_words=1000)
    assert snap(0, 0, sents, (10, 20), 40) is None


def test_padding_never_overlaps_neighbouring_words():
    words = mk_words([("A", 0, .5), ("one.", .55, 1.0), ("B", 1.05, 1.5), ("two.", 1.55, 2.0), ("C", 2.05, 2.5), ("three.", 2.55, 3.0)])
    sents = split_sentences(words)
    a, b = snap(1, 1, sents, (0.5, 60), 3.0)
    assert a >= 1.0 and b <= 2.05 - 0.05 + 1e-9


def test_dedupe_keeps_higher_score():
    clips = [{"startSec": 0, "endSec": 30, "score": 50}, {"startSec": 5, "endSec": 32, "score": 80}, {"startSec": 60, "endSec": 90, "score": 10}]
    out = dedupe(clips)
    assert [c["score"] for c in out] == [80, 10]


def test_unpunctuated_speech_with_no_pauses_gives_full_chunks_not_single_words():
    words = [{"w": f"w{i}", "s": i * 0.2, "e": i * 0.2 + 0.2} for i in range(200)]  # no punctuation, zero gaps
    s = split_sentences(words, max_words=40)
    assert min(x.n_words for x in s[:-1]) >= 20
    assert sum(x.n_words for x in s) == 200
