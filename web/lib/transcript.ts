/** Transcript-first editing: trim, extend and cut a clip by its words. Indices point into the editor's word list
 * (the clip plus ±30 s of context). Times are source seconds. */
import type { Range } from './cuts'

type Word = { w: string; s: number; e: number }
type Trim = { start: number; end: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000
const SENTENCE_END = /[.?!…]["'”’)\]]*$/
const LEAD = 0.1, TAIL = 0.15 // breath kept before the first word and after the last
export const MIN_CLIP = 1

export const inTrim = (w: Word, t: Trim) => w.s >= t.start - 0.05 && w.e <= t.end + 0.05

/** [first, last] word index of each sentence: ends on . ? ! (or a long silence, for unpunctuated transcripts). */
export function sentences(words: Word[]): [number, number][] {
  const out: [number, number][] = []
  let a = 0
  words.forEach((w, i) => {
    const next = words[i + 1]
    if (!next || SENTENCE_END.test(w.w) || next.s - w.e > 1.2) { out.push([a, i]); a = i + 1 }
  })
  return out
}

/** Where a clip made of words i…j starts and ends: a little before the first word, a little after the last, never into a neighbour. */
export function span(words: Word[], i: number, j: number): Trim {
  const prev = words[i - 1], next = words[j + 1]
  const start = words[i].s - Math.min(LEAD, prev ? Math.max(0, words[i].s - prev.e) / 2 : LEAD)
  const end = words[j].e + Math.min(TAIL, next ? Math.max(0, next.s - words[j].e) / 2 : TAIL)
  return { start: r3(Math.max(0, start)), end: r3(end) }
}

/** The clip becomes exactly words i…j (also extends it, when they reach outside). */
export const trimTo = (words: Word[], i: number, j: number): Trim => span(words, Math.min(i, j), Math.max(i, j))

/** Extends the clip with the sentence [i, j] and everything between it and the clip. */
export function extendTo(words: Word[], trim: Trim, [i, j]: [number, number]): Trim {
  const s = span(words, i, j)
  return { start: Math.min(trim.start, s.start), end: Math.max(trim.end, s.end) }
}

/** Removes words i…j: at either end of the clip the trim moves in; in the middle it becomes a cut (gap halves included,
 * so the words either side join naturally). null: that would remove the whole clip. */
export function cutOut(words: Word[], trim: Trim, cuts: Range[], i: number, j: number): { trim: Trim; cuts: Range[] } | null {
  const idx = words.map((w, k) => (inTrim(w, trim) ? k : -1)).filter((k) => k >= 0)
  if (!idx.length) return null
  const first = idx[0], last = idx[idx.length - 1]
  const a = Math.max(Math.min(i, j), first), b = Math.min(Math.max(i, j), last)
  if (a > b) return null
  if (a === first && b === last) return null
  if (a === first) return { trim: { ...trim, start: span(words, b + 1, last).start }, cuts }
  if (b === last) return { trim: { ...trim, end: span(words, first, a - 1).end }, cuts }
  const cut: Range = [r3((words[a - 1].e + words[a].s) / 2), r3((words[b].e + words[b + 1].s) / 2)]
  return { trim, cuts: merge([...cuts, cut]) }
}

/** Puts back every hand cut that touches [a, b]. */
export const restore = (cuts: Range[], a: number, b: number): Range[] => cuts.filter(([s, e]) => e < a || s > b)

function merge(rs: Range[]): Range[] {
  const out: Range[] = []
  for (const r of [...rs].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}
