/**
 * Subtitle style + words → ASS (libass). The editor preview (JASSUB) and the export (FFmpeg) both draw this exact text,
 * so they match. worker/clipforge_worker/render/ass.py is a line-by-line port; shared/ass-fixtures keeps them identical.
 */
import FONTS from '@/public/fonts/fonts.json'
import type { POSITIONS } from '@/lib/constants'
import type { SubtitleStyle } from './subtitle-presets'

type Position = (typeof POSITIONS)[number]

export interface AssWord { w: string; s: number; e: number }
export interface AssWatermark { value: string; font: string; color: string; opacity: number; position: Position; marginPct: number; sizePct: number }
export interface AssHook { text: string; end: number }
export interface AssInput { style: SubtitleStyle; words: AssWord[]; width: number; height: number; duration: number; watermarkText?: AssWatermark | null; hook?: AssHook | null }

export const FALLBACK_FONT = 'Noto Sans Devanagari'
/** Every bundled font file. The preview preloads them all into libass (~1 MB), as FFmpeg's fontsdir does for the export, so both
 * match fonts by their internal names the same way (JASSUB's own name lookup guesses from weight words and misses e.g. "Montserrat Thin ExtraBold"). */
export const FONT_FILES: string[] = FONTS.map((f) => `/fonts/${f.file}`)

const SUB_TOP = { top: 15, middle: 50, bottom: 72 } // % of height, centre of the subtitle block (as the Phase 1 preview)
const ALIGN: Record<Position, number> = { tl: 7, tc: 8, tr: 9, ml: 4, c: 5, mr: 6, bl: 1, bc: 2, br: 3 }
const DEVANAGARI = /[ऀ-ॿ]/

const round = (n: number) => Math.floor(n + 0.5) // same half-up rounding in Python
const num = (n: number) => String(round(n * 100) / 100)
const bgr = (hex: string) => hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3)
const colour = (hex: string, alpha = 0) => `&H${alpha.toString(16).toUpperCase().padStart(2, '0')}${bgr(hex).toUpperCase()}`
const alphaOf = (opacityPct: number) => round(255 * (1 - opacityPct / 100))
const tag = (hex: string) => `&H${bgr(hex).toUpperCase()}&`

export function time(t: number): string {
  const cs = round(Math.max(0, t) * 100)
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60, c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

/** Nearest bundled weight of a family (tie → heavier); unknown family → Inter. */
export function fontFor(family: string, weight: number): { name: string; bold: boolean } {
  let c = FONTS.filter((f) => f.family === family)
  if (!c.length) c = FONTS.filter((f) => f.family === 'Inter')
  const best = c.reduce((a, b) => {
    const da = Math.abs(a.weight - weight), db = Math.abs(b.weight - weight)
    return db < da || (db === da && b.weight > a.weight) ? b : a
  })
  return { name: best.assName, bold: best.bold }
}

const clean = (w: string, c: SubtitleStyle['case']) =>
  (c === 'upper' ? w.toUpperCase() : c === 'lower' ? w.toLowerCase() : w).replace(/\{/g, '(').replace(/\}/g, ')').replace(/\\/g, '/')

function styleLine(name: string, font: { name: string; bold: boolean }, size: number, primary: string, secondary: string, outline: string,
  back: string, borderStyle: number, outlineW: number, shadow: number, align: number, ml: number, mr: number, mv: number): string {
  return `Style: ${name},${font.name},${num(size)},${primary},${secondary},${outline},${back},${font.bold ? -1 : 0},0,0,0,100,100,0,0,` +
    `${borderStyle},${num(outlineW)},${num(shadow)},${align},${ml},${mr},${mv},1`
}

export function buildAss(i: AssInput): string {
  const { style: st, width: W, height: H } = i
  const words = i.words.map((w) => ({ ...w, w: clean(w.w, st.case) }))
  const font = fontFor(words.some((w) => DEVANAGARI.test(w.w)) ? FALLBACK_FONT : st.font, st.weight)
  const box = st.box // BorderStyle 4: one box behind the whole line (3 draws a box per run, and overlaps darken)
  const styles = [box
    ? styleLine('Default', font, st.sizePx, colour(st.color), colour(st.activeColor), colour(box.color, alphaOf(box.opacity)), colour(box.color, alphaOf(box.opacity)), 4, box.padding, 0, 5, round(W * 0.05), round(W * 0.05), 0)
    : styleLine('Default', font, st.sizePx, colour(st.color), colour(st.activeColor), colour(st.stroke.color), colour(st.shadow?.color ?? '#000000'), 1, st.stroke.width, 0, 5, round(W * 0.05), round(W * 0.05), 0)]
  const wm = i.watermarkText
  if (wm?.value) {
    const m = round((W * wm.marginPct) / 100)
    styles.push(styleLine('Watermark', fontFor(wm.font, 600), round((W * Math.max(2.5, wm.sizePct / 3)) / 100), colour(wm.color, alphaOf(wm.opacity)),
      colour(wm.color), colour('#000000', 0x80), colour('#000000', 0x80), 1, 0, 2, ALIGN[wm.position], m, m, m))
  }
  const hook = i.hook?.text.trim() ? i.hook : null
  if (hook) { // the AI hook line: dark text on a white box over the first seconds
    const u = Math.min(W, H)
    styles.push(styleLine('Hook', fontFor(DEVANAGARI.test(hook.text) ? FALLBACK_FONT : st.font, 800), round(u * 0.065), colour('#111113'), colour('#111113'),
      colour('#FFFFFF'), colour('#FFFFFF'), 4, round(u * 0.02), 0, 5, round(W * 0.1), round(W * 0.1), 0))
  }

  const x = round(W / 2)
  const y = round((H * Math.min(95, Math.max(5, SUB_TOP[st.position] + st.offsetPct))) / 100)
  let fx = ''
  if (st.shadow) {
    if (st.shadow.x || st.shadow.y) fx += `\\xshad${num(st.shadow.x)}\\yshad${num(st.shadow.y)}`
    if (st.shadow.blur) fx += `\\blur${num(st.shadow.blur / 4)}`
  }
  const primary = tag(st.color), active = tag(st.activeColor)
  const per = st.wordsPerLine * st.lines
  const events: string[] = []
  const join = (ws: string[]) => ws.map((w, k) => (k > 0 ? (st.lines === 2 && k === st.wordsPerLine ? '\\N' : ' ') : '') + w).join('')
  const ev = (a: number, b: number, tags: string, text: string) => events.push(`Dialogue: 0,${time(a)},${time(Math.min(b, i.duration))},Default,,0,0,0,,{${tags}}${text}`)

  for (let c = 0; c < words.length; c += per) {
    const chunk = words.slice(c, c + per), next = words[c + per]
    const last = chunk[chunk.length - 1]
    const hold = next && next.s - last.e < 0.5 ? next.s : last.e
    const pos = `\\pos(${x},${y})`
    if (st.animation === 'fade' || st.animation === 'none') {
      ev(chunk[0].s, hold, pos + fx + (st.animation === 'fade' ? '\\fad(120,120)' : ''), join(chunk.map((w) => w.w)))
      continue
    }
    chunk.forEach((w, k) => {
      const end = k < chunk.length - 1 ? chunk[k + 1].s : hold
      const shown = st.animation === 'typewriter' ? chunk.slice(0, k + 1) : chunk
      const text = join(shown.map((sw, j) => j !== k ? sw.w
        : st.animation === 'pop' ? `{\\1c${active}\\t(0,80,\\fscx118\\fscy118)\\t(80,160,\\fscx108\\fscy108)}${sw.w}{\\1c${primary}\\fscx100\\fscy100}`
          : `{\\1c${active}}${sw.w}{\\1c${primary}}`))
      const at = st.animation === 'slide' && k === 0 ? `\\move(${x},${y + round(H * 0.02)},${x},${y},0,150)` : pos
      ev(w.s, end, at + fx, text)
    })
  }
  if (wm?.value) events.push(`Dialogue: 1,${time(0)},${time(i.duration)},Watermark,,0,0,0,,${clean(wm.value, 'none')}`)
  if (hook) {
    const hy = round((H * (st.position === 'top' ? 34 : 22)) / 100) // clear of top-placed subtitles
    events.push(`Dialogue: 2,${time(0)},${time(Math.min(hook.end, i.duration))},Hook,,0,0,0,,{\\pos(${x},${hy})\\fad(150,200)}${clean(hook.text.trim(), 'none')}`)
  }

  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: None', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events, '',
  ].join('\n')
}
