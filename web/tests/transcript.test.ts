import { expect, test } from 'vitest'
import { cutOut, extendTo, restore, sentences, span, trimTo } from '@/lib/transcript'
import { keepRanges } from '@/lib/cuts'
import { shotAt, withFocus } from '@/lib/editor'

const W = (w: string, s: number, e: number) => ({ w, s, e })
// "Hi there. How are you? Fine" — 0–1 context before, clip 2–8, context after
const words = [W('Before.', 0, 0.6), W('Hi', 2, 2.3), W('there.', 2.4, 2.9), W('How', 3.5, 3.7), W('are', 3.8, 4), W('you?', 4.1, 4.5), W('Fine', 6, 6.4), W('ok.', 6.5, 7.9), W('After', 9, 9.5)]
const trim = { start: 1.9, end: 8 }

test('sentences end on . ? ! or a long silence', () => {
  expect(sentences(words)).toEqual([[0, 0], [1, 2], [3, 5], [6, 7], [8, 8]])
  expect(sentences([W('no', 0, 1), W('punctuation', 1.1, 2), W('here', 5, 6)])).toEqual([[0, 1], [2, 2]])
})

test('a span keeps a breath around its words without reaching into the neighbours', () => {
  expect(span(words, 3, 5)).toEqual({ start: 3.4, end: 4.65 })
  expect(span(words, 1, 1)).toEqual({ start: 1.9, end: 2.35 }) // only half the 0.1 s gap after "Hi"
  expect(trimTo(words, 5, 3)).toEqual(span(words, 3, 5))      // selection made backwards
})

test('extending adds a whole sentence and everything between it and the clip', () => {
  expect(extendTo(words, trim, [0, 0])).toEqual({ start: 0, end: 8 })
  expect(extendTo(words, trim, [8, 8])).toEqual({ start: 1.9, end: 9.65 })
})

test('cutting at an end of the clip moves the trim; in the middle it adds a cut; never the whole clip', () => {
  expect(cutOut(words, trim, [], 1, 2)).toEqual({ trim: { start: 3.4, end: 8 }, cuts: [] })
  expect(cutOut(words, trim, [], 6, 7)!.trim.end).toBe(4.65)
  expect(cutOut(words, trim, [], 3, 5)).toEqual({ trim, cuts: [[3.2, 5.25]] })
  expect(cutOut(words, trim, [], 0, 8)).toBeNull()       // selection beyond the clip, clamped to it: all of it
  expect(cutOut(words, trim, [[3, 3.6]], 3, 4)!.cuts).toEqual([[3, 4.05]]) // overlapping cuts merge
  expect(restore([[3.2, 5.25], [7, 7.5]], 4, 4.2)).toEqual([[7, 7.5]])
})

test('hand cuts are removed from what plays, like fillers', () => {
  expect(keepRanges(trim, words, [], { fillers: false, pauses: false, cuts: [[3.2, 5.25]] })).toEqual([[1.9, 3.2], [5.25, 8]])
})

test('the shot under the playhead, and framing one by hand', () => {
  expect(shotAt([5, 12, 30], 60, 0)).toEqual([0, 5])
  expect(shotAt([5, 12, 30], 60, 12)).toEqual([12, 30])
  expect(shotAt([5, 12, 30], 60, 45)).toEqual([30, 60])
  const f = withFocus([[0, 5, 0.2, 0.5]], [12, 30], 0.712345, 0.4)
  expect(f).toEqual([[0, 5, 0.2, 0.5], [12, 30, 0.7123, 0.4]])
  expect(withFocus(f, [12, 30], 0.3, 0.3)).toEqual([[0, 5, 0.2, 0.5], [12, 30, 0.3, 0.3]]) // replaces, not stacks
  expect(withFocus(f, [0, 5], null)).toEqual([[12, 30, 0.7123, 0.4]])
})
