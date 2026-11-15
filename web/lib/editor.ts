import type { LayoutId } from './layouts'
import type { Word } from './mock'
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
