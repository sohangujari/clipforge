/**
 * Filler/pause removal and auto-zoom, as times. The editor works these out and saves them with the clip (edit.keep,
 * edit.zooms); the export renders exactly those. Retiming words to the cut clip (retimeWords) and the zoom curve (zoomAt)
 * are mirrored in worker/clipforge_worker/render/cuts.py — shared/cuts-fixture.json keeps the two identical.
 * Times: source seconds unless named "out" (seconds into the finished, cut clip).
 */
import type { AssWord } from './ass'

export type Range = [number, number]
type Word = { w: string; s: number; e: number; speaker?: number }

export const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'hm', 'mm', 'mhm'])
export const PAUSE_MIN = 0.5  // shorter pauses are speech rhythm — keep them
export const PAD = 0.12       // left either side of a removed pause, so cuts don't clip breaths or word tails
const MIN_KEEP = 0.2          // a kept sliver shorter than this would flash; drop it
const MIN_CUT = 0.1
const MIN_HEARD = 0.05
export const ZOOM = 1.12, ZOOM_IN = 0.12, ZOOM_OUT = 0.3
const ZOOM_GAP = 3            // seconds between punch-ins

const r3 = (n: number) => Math.round(n * 1000) / 1000
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/** The parts of the trim that play, in order. Pauses come from the audio (silences.json), fillers from the transcript,
 * o.cuts from the transcript panel (parts the creator cut out by hand). */
export function keepRanges(trim: { start: number; end: number }, words: Word[], silences: Range[], o: { fillers: boolean; pauses: boolean; cuts?: Range[] }): Range[] {
  const { start, end } = trim
  const cut: Range[] = []
  if (o.pauses) for (const [a, b] of silences) {
    if (b - a < PAUSE_MIN || b <= start || a >= end) continue
    cut.push([a <= start ? start : a + PAD, b >= end ? end : b - PAD]) // no padding kept at the clip's own edges
  }
  if (o.fillers) for (const w of words) if (w.s < end && w.e > start && FILLERS.has(norm(w.w))) cut.push([w.s, w.e])
  for (const c of o.cuts ?? []) cut.push(c)
  cut.sort((x, y) => x[0] - y[0])
  const keep: Range[] = []
  let at = start
  for (const [a0, b0] of cut) {
    const a = Math.max(a0, start), b = Math.min(b0, end)
    if (b - a < MIN_CUT) continue
    if (a - at >= MIN_KEEP) keep.push([at, a])
    at = Math.max(at, b)
  }
  if (end - at >= MIN_KEEP) keep.push([at, end])
  return keep.length ? keep.map(([a, b]) => [r3(a), r3(b)]) : [[start, end]]
}

export const keptDuration = (keep: Range[]) => r3(keep.reduce((n, [a, b]) => n + b - a, 0))

/** Source time → time in the cut clip. Inside a removed part: where the next kept part starts. */
export function toOut(keep: Range[], t: number): number {
  let o = 0
  for (const [a, b] of keep) {
    if (t < a) return o
    if (t <= b) return o + t - a
    o += b - a
  }
  return o
}

/** Is any of word w still heard after the cuts? (the same test retimeWords uses) */
export const heard = (keep: Range[], w: Word) => r3(toOut(keep, w.e)) - r3(toOut(keep, w.s)) >= MIN_HEARD

/** Subtitle words on the cut clip's clock. A word stays if some of it is still heard (Whisper stretches words over
 * pauses, so a cut can take part of one); words entirely inside a cut — fillers — go. */
export function retimeWords(words: Word[], keep: Range[]): AssWord[] {
  const out: AssWord[] = []
  for (const w of words) {
    const s = r3(toOut(keep, w.s)), e = r3(toOut(keep, w.e))
    if (e - s >= MIN_HEARD) out.push({ w: w.w, s, e, ...(w.speaker !== undefined && { sp: w.speaker }) })
  }
  return out
}

/** Punch-in moments: on the AI's keywords, or (no keywords) on long words, at least ZOOM_GAP apart. */
export function zoomRanges(words: Word[], keep: Range[], keywords: string[]): Range[] {
  const kws = new Set(keywords.flatMap((k) => k.split(/\s+/)).map(norm).filter((k) => k.length > 2))
  const kept = words.filter((w) => keep.some(([a, b]) => (w.s + w.e) / 2 >= a && (w.s + w.e) / 2 <= b))
  const hits = kept.filter((w) => (kws.size ? kws.has(norm(w.w)) : norm(w.w).length >= 7))
  const out: Range[] = []
  for (const w of hits) {
    if (out.length && w.s < out[out.length - 1][1] + ZOOM_GAP) continue
    out.push([r3(w.s), r3(Math.min(w.s + 2, Math.max(w.e + 0.5, w.s + 1)))])
  }
  return out
}

/** Zoom factor at source time t: ease in over ZOOM_IN, hold, ease out over ZOOM_OUT. */
export function zoomAt(zooms: Range[], t: number): number {
  let z = 0
  for (const [a, b] of zooms) z += Math.min(1, Math.max(0, (t - a) / ZOOM_IN)) * Math.min(1, Math.max(0, (b - t) / ZOOM_OUT))
  return 1 + (ZOOM - 1) * z
}

/** Where subtitles move to the divider: split/grid ranges (source [start, end, rows]) on the cut clip's clock. Rows stack
 * only at 9:16 and 1:1 (16:9 uses columns: subtitles stay put). 2 rows → the middle; 3 → between the 2nd and 3rd. */
export function middleRanges(ranges: [number, number, number][], keep: Range[], vertical: boolean): [number, number, number][] {
  if (!vertical) return []
  return ranges.map(([a, b, k]): [number, number, number] => [r3(toOut(keep, a)), r3(toOut(keep, b)), k === 2 ? 50 : 66.67]).filter(([a, b]) => b > a)
}
