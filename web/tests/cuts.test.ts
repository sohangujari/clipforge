import { expect, test } from 'vitest'
import { keepRanges, keptDuration, retimeWords, toOut, zoomAt, zoomRanges } from '@/lib/cuts'
import { nextPlayable } from '@/components/cf/ClipVideo'

const W = (w: string, s: number, e: number) => ({ w, s, e })
const on = { fillers: true, pauses: true }

test('long pauses shrink to a short breath; short ones and the clip edges are handled', () => {
  const trim = { start: 0, end: 10 }
  expect(keepRanges(trim, [], [[2, 3], [5, 5.3]], on)).toEqual([[0, 2.12], [2.88, 10]]) // 0.3 s pause kept
  expect(keepRanges(trim, [], [[-1, 1], [9.5, 12]], on)).toEqual([[0.88, 9.62]]) // leading/trailing silence removed but for a breath
  expect(keepRanges(trim, [], [[2, 3]], { fillers: true, pauses: false })).toEqual([[0, 10]])
  expect(keepRanges(trim, [], [[-1, 20]], on)).toEqual([[0, 10]]) // nothing left → keep the whole trim rather than an empty clip
})

test('fillers are cut, matched without case or punctuation; a sliver left between two cuts is dropped', () => {
  const words = [W('So', 1, 1.3), W('Um,', 1.4, 1.8), W('right', 1.9, 2.2), W('uh', 2.3, 2.6)]
  expect(keepRanges({ start: 0, end: 5 }, words, [], on)).toEqual([[0, 1.4], [1.8, 2.3], [2.6, 5]])
  expect(keepRanges({ start: 0, end: 5 }, words, [[2.65, 3.6]], on)).toEqual([[0, 1.4], [1.8, 2.3], [3.48, 5]])
  expect(keepRanges({ start: 0, end: 5 }, [W('um', 1, 1.2), W('uh', 1.35, 1.6)], [], on)).toEqual([[0, 1], [1.6, 5]])
})

test('times map onto the cut clip; words in cuts disappear', () => {
  const keep: [number, number][] = [[10, 12], [13, 15]]
  expect(keptDuration(keep)).toBe(4)
  expect([toOut(keep, 9), toOut(keep, 11), toOut(keep, 12.5), toOut(keep, 14), toOut(keep, 20)]).toEqual([0, 1, 2, 3, 4])
  expect(retimeWords([W('a', 10.5, 11), W('um', 12.1, 12.9), W('b', 11.8, 13.4), W('c', 11.98, 13.02)], keep))
    .toEqual([{ w: 'a', s: 0.5, e: 1 }, { w: 'b', s: 1.8, e: 2.4 }]) // b: stretched over the cut, still heard; c: 0.04 s left
})

test('preview playback skips cuts and loops', () => {
  const keep: [number, number][] = [[10, 12], [13, 15]]
  expect([nextPlayable(keep, 11), nextPlayable(keep, 12.4), nextPlayable(keep, 15), nextPlayable(keep, 5)]).toEqual([11, 13, 10, 10])
})

test('zooms land on AI keywords, spaced out; without keywords, on long words', () => {
  const words = [W('This', 0, 0.3), W('changed', 0.4, 0.8), W('EVERYTHING!', 0.9, 1.5), W('everything', 2, 2.5), W('everything', 6, 6.4)]
  const keep: [number, number][] = [[0, 10]]
  expect(zoomRanges(words, keep, ['everything'])).toEqual([[0.9, 2], [6, 7]])
  expect(zoomRanges(words, keep, [])).toEqual([[0.4, 1.4], [6, 7]])
  expect(zoomRanges(words, [[3, 10]], ['everything'])).toEqual([[6, 7]]) // never on a cut word
  expect(zoomAt([[1, 2]], 0.5)).toBe(1)
  expect(zoomAt([[1, 2]], 1.5)).toBeCloseTo(1.12)
  expect(zoomAt([[1, 2]], 1.06)).toBeCloseTo(1.06)
})
