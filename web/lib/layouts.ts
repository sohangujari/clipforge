import type { CONTENT_TYPES } from './constants'

export type ContentType = (typeof CONTENT_TYPES)[number]
export type LayoutId = 'single' | 'active-speaker' | 'split' | 'wide-blur' | 'grid' | 'facecam-top' | 'facecam-bottom' | 'pip' | 'gameplay-only' | 'reaction-stack' | 'screen-zoom'
export interface ThumbRect { x: number; y: number; w: number; h: number; kind: 'face' | 'game' | 'screen' | 'blur' | 'caption' }
export interface LayoutOption { id: LayoutId; label: string; contentTypes: ContentType[]; thumb: ThumbRect[] }

const cap = (y: number): ThumbRect => ({ x: 0.15, y, w: 0.7, h: 0.05, kind: 'caption' })

/** Rects are fractions of a 9:16 frame, drawn as SVG thumbnails. */
export const LAYOUTS: LayoutOption[] = [
  { id: 'single', label: 'Single speaker', contentTypes: ['podcast', 'vlog', 'custom'], thumb: [{ x: 0, y: 0, w: 1, h: 1, kind: 'face' }, cap(0.72)] },
  { id: 'active-speaker', label: 'Active speaker', contentTypes: ['podcast'], thumb: [{ x: 0, y: 0, w: 1, h: 1, kind: 'face' }, { x: 0.7, y: 0.04, w: 0.24, h: 0.12, kind: 'face' }, cap(0.72)] },
  { id: 'split', label: 'Split screen', contentTypes: ['podcast', 'reaction'], thumb: [{ x: 0, y: 0, w: 1, h: 0.5, kind: 'face' }, { x: 0, y: 0.5, w: 1, h: 0.5, kind: 'face' }, cap(0.475)] },
  { id: 'wide-blur', label: 'Wide + blur', contentTypes: ['podcast', 'sports', 'custom'], thumb: [{ x: 0, y: 0, w: 1, h: 1, kind: 'blur' }, { x: 0, y: 0.34, w: 1, h: 0.32, kind: 'face' }, cap(0.72)] },
  { id: 'grid', label: 'Grid', contentTypes: ['podcast'], thumb: [{ x: 0, y: 0, w: 0.5, h: 0.5, kind: 'face' }, { x: 0.5, y: 0, w: 0.5, h: 0.5, kind: 'face' }, { x: 0, y: 0.5, w: 0.5, h: 0.5, kind: 'face' }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5, kind: 'face' }, cap(0.475)] },
  { id: 'facecam-top', label: 'Facecam top', contentTypes: ['gaming'], thumb: [{ x: 0, y: 0, w: 1, h: 0.35, kind: 'face' }, { x: 0, y: 0.35, w: 1, h: 0.65, kind: 'game' }, cap(0.33)] },
  { id: 'facecam-bottom', label: 'Facecam bottom', contentTypes: ['gaming'], thumb: [{ x: 0, y: 0, w: 1, h: 0.65, kind: 'game' }, { x: 0, y: 0.65, w: 1, h: 0.35, kind: 'face' }, cap(0.63)] },
  { id: 'pip', label: 'Picture-in-picture', contentTypes: ['gaming', 'tutorial'], thumb: [{ x: 0, y: 0, w: 1, h: 1, kind: 'game' }, { x: 0.62, y: 0.06, w: 0.32, h: 0.18, kind: 'face' }, cap(0.72)] },
  { id: 'gameplay-only', label: 'Gameplay only', contentTypes: ['gaming', 'sports'], thumb: [{ x: 0, y: 0, w: 1, h: 1, kind: 'game' }, cap(0.72)] },
  { id: 'reaction-stack', label: 'Reaction stack', contentTypes: ['reaction'], thumb: [{ x: 0, y: 0, w: 1, h: 0.5, kind: 'screen' }, { x: 0, y: 0.5, w: 1, h: 0.5, kind: 'face' }, cap(0.475)] },
  { id: 'screen-zoom', label: 'Screen zoom', contentTypes: ['tutorial'], thumb: [{ x: 0, y: 0, w: 1, h: 1, kind: 'screen' }, { x: 0.62, y: 0.78, w: 0.3, h: 0.17, kind: 'face' }, cap(0.1)] },
]

export const layoutsFor = (t: ContentType): LayoutOption[] =>
  t === 'auto' ? LAYOUTS : LAYOUTS.filter((l) => l.contentTypes.includes(t))
