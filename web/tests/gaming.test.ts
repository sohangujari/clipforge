import { expect, test } from 'vitest'
import { atSeam, blockedRects, clearSpot, cover, detectFacecam, HUD_PRESETS, regions, type GameOpts } from '@/lib/gaming'
import { defaultLayout } from '@/lib/people'
import { applyTemplate, templateFrom } from '@/lib/layout-templates'
import { builtinPresets } from '@/lib/subtitle-presets'
import type { EditorState } from '@/lib/editor'

const cam = { x: 0, y: 0.7, w: 0.25, h: 0.3 }
const o: GameOpts = { facecam: cam, game: [0.5, 0.5], pip: { x: 0.76, y: 0.15, size: 0.36, shape: 'circle' } }

test('facecam top: the webcam fills the top 35%, the gameplay the rest, both cropped to their slot', () => {
  const [face, game] = regions('facecam-top', o, 1920, 1080, 1080, 1920)
  expect(face.dst).toEqual([0, 0, 1080, 672])
  expect(game.dst).toEqual([0, 672, 1080, 1248])
  expect(face.src[2] / face.src[3]).toBeCloseTo(1080 / 672, 1)
  expect(face.src[0]).toBeGreaterThanOrEqual(0); expect(face.src[0] + face.src[2]).toBeLessThanOrEqual(480) // inside the box
  expect(game.src[3]).toBe(1080) // full-height centre crop of the gameplay
})

test('PiP: the bubble sits where it was dragged, clamped inside the frame; no facecam means gameplay only', () => {
  const [, bubble] = regions('pip', { ...o, pip: { x: 0.99, y: 0, size: 0.4, shape: 'rounded' } }, 1920, 1080, 1080, 1920)
  expect(bubble).toMatchObject({ shape: 'rounded', dst: [648, 0, 432, 324] })
  expect(regions('pip', { ...o, facecam: null }, 1920, 1080, 1080, 1920)).toHaveLength(1)
  expect(cover({ x: 0, y: 0, w: 1, h: 1 }, 1920, 1080, 1)).toEqual([420, 0, 1080, 1080])
})

test('detects a webcam overlay: a small face that stays put over gameplay', () => {
  const frames = Array.from({ length: 100 }, (_, i) => [
    ...(i % 3 ? [[0.12 + (i % 2) * 0.004, 0.82, 0.06, 0.1]] : []), // the streamer, most frames
    ...(i % 10 === 0 ? [[(i * 0.37) % 1, (i * 0.61) % 1, 0.05, 0.08]] : []), // faces in the game, anywhere
  ])
  const box = detectFacecam(frames, 1920, 1080)!
  expect(box.x).toBe(0) // snapped to the left edge
  expect(box.x + box.w).toBeGreaterThan(0.13); expect(box.y).toBeLessThan(0.78); expect(box.y + box.h).toBeGreaterThan(0.86)
  expect(detectFacecam(Array.from({ length: 100 }, () => [[0.5, 0.4, 0.3, 0.5]]), 1920, 1080)).toBeNull() // a talking head
  expect(detectFacecam(Array.from({ length: 100 }, (_, i) => (i < 10 ? [[0.2, 0.2, 0.05, 0.08]] : [])), 1920, 1080)).toBeNull() // rare
})

test('subtitles move off the HUD and the facecam, to the nearest clear spot', () => {
  const rs = regions('gameplay-only', o, 1920, 1080, 1080, 1920)
  const blocked = blockedRects(rs, HUD_PRESETS.find((p) => p.id === 'minecraft')!.zones, 1920, 1080)
  expect(blocked).toHaveLength(1) // the hotbar, centred, is in the crop
  const y = clearSpot(blocked, 1080, 1920, 6, 90)
  expect(y).toBeLessThan(84)
  expect(clearSpot([], 1080, 1920, 6, 72)).toBe(72)
  const top = regions('facecam-top', o, 1920, 1080, 1080, 1920)
  expect(clearSpot(blockedRects(top, [], 1920, 1080), 1080, 1920, 6, 20)).toBeGreaterThanOrEqual(38) // below the webcam
})

test('streams start on facecam top (subtitles on the seam), or gameplay only without a webcam', () => {
  expect(defaultLayout(null, 'gaming', cam)).toBe('facecam-top')
  expect(defaultLayout(null, 'gaming', null)).toBe('gameplay-only')
  expect(defaultLayout(null, 'reaction', cam)).toBe('reaction-stack')
  expect(defaultLayout(null, 'podcast', cam)).toBe('single')
  expect(atSeam(builtinPresets[0], 'facecam-top', true)).toMatchObject({ position: 'middle', offsetPct: -15 })
  expect(atSeam(builtinPresets[0], 'facecam-top', false)).toBe(builtinPresets[0])
})

test('a layout template keeps the facecam box, bubble and HUD zones', () => {
  const s = { layoutId: 'pip', aspect: '9:16', style: builtinPresets[0], brand: { position: 'br' }, facecam: cam, pip: o.pip,
    hud: { preset: 'gta', zones: HUD_PRESETS[0].zones } } as unknown as EditorState
  const t = templateFrom(s, 'My GTA layout', 'x')
  expect(applyTemplate({ ...s, facecam: null, hud: { preset: null, zones: [] } }, t)).toMatchObject({ layoutId: 'pip', facecam: cam, hud: { preset: 'gta' } })
})
