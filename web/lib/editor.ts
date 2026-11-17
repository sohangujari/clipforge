import type { LayoutId } from './layouts'
import type { Word } from './mock'
import type { Range } from './cuts'
import type { Focus } from './reframe'
import type { Box, Pip } from './gaming'
import type { SettingValue } from './settings'
import type { SubtitleStyle } from './subtitle-presets'

export type Aspect = '9:16' | '1:1' | '16:9'
export type SafeZone = 'off' | 'tiktok' | 'reels' | 'shorts'
export type BrandKit = SettingValue<'brandKit'>

/** Everything undo/redo covers. Playhead is not here on purpose. */
export interface EditorState {
  aspect: Aspect
  layoutId: LayoutId
  style: SubtitleStyle
  subtitlesOn: boolean
  watermarkOn: boolean
  brand: BrandKit
  trim: { start: number; end: number }
  words: Word[]
  safeZone: SafeZone
  resolution: '1080p' | '720p'
  removeFillers: boolean
  removePauses: boolean
  autoZoom: boolean
  hook: { on: boolean; text: string }
  bumpers: boolean
  /** parts cut out in the transcript panel (source time) */
  cuts: Range[]
  /** camera shots framed by hand (drag in the canvas) */
  focus: Focus[]
  /** subtitle words in their speaker's colour */
  speakerColors: boolean
  /** Phase 7, gaming layouts: the webcam overlay in the source frame (null: none found or drawn yet), the gameplay crop's
   * centre, the picture-in-picture bubble, and the game's HUD zones (subtitles are kept off them) */
  facecam: Box | null
  game: [number, number]
  pip: Pip
  hud: { preset: string | null; zones: Box[] }
}

export const ASPECT_RATIO: Record<Aspect, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 }

/** The subtitle chunk on screen at time t (words grouped by perChunk), and which word in it is being spoken (-1 if none). */
export function chunkAt(words: Word[], perChunk: number, t: number): { words: Word[]; active: number } {
  if (!words.length) return { words: [], active: -1 }
  let i = words.findIndex((w) => w.s <= t && t < w.e)
  const speaking = i !== -1
  if (!speaking) i = t < words[0].s ? 0 : words.findLastIndex((w) => w.s <= t)
  const start = Math.floor(i / perChunk) * perChunk
  return { words: words.slice(start, start + perChunk), active: speaking ? i - start : -1 }
}

/** The camera shot playing at t: [last cut ≤ t, next cut] (cuts sorted; the video's own ends otherwise). */
export function shotAt(cuts: number[], duration: number, t: number): [number, number] {
  let a = 0
  for (const c of cuts) {
    if (c > t) return [a, c]
    a = c
  }
  return [a, duration]
}

/** state.focus with shot [a, b] framed at (x, y), or back to auto tracking (x = null). */
export function withFocus(focus: EditorState['focus'], [a, b]: [number, number], x: number | null, y = 0.5): EditorState['focus'] {
  const rest = focus.filter(([s, e]) => e <= a || s >= b)
  return x === null ? rest : [...rest, [a, b, Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]].sort((p, q) => p[0] - q[0]) as EditorState['focus']
}
