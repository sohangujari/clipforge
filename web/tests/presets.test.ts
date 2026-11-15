import { expect, test } from 'vitest'
import { builtinPresets, SubtitleStyleSchema } from '@/lib/subtitle-presets'
import { LAYOUTS, layoutsFor } from '@/lib/layouts'
import { schemas } from '@/lib/settings'

test('10 valid, unique, non-trademark presets', () => {
  expect(builtinPresets.length).toBe(10)
  for (const p of builtinPresets) SubtitleStyleSchema.parse(p)
  expect(new Set(builtinPresets.map((p) => p.id)).size).toBe(10)
  expect(builtinPresets.some((p) => /mrbeast|hormozi/i.test(p.name))).toBe(false)
  expect(builtinPresets[0].id).toBe('bold-pop')
})

test('custom presets are validated', () => {
  expect(() => schemas.subtitlePresets.parse({ custom: [{ id: 'x' }], defaultId: 'bold-pop' })).toThrow()
  expect(schemas.subtitlePresets.parse({ custom: [builtinPresets[1]], defaultId: 'big-yellow' }).custom).toHaveLength(1)
})

test('layouts per content type', () => {
  expect(LAYOUTS.length).toBe(11)
  expect(layoutsFor('podcast').length).toBeGreaterThanOrEqual(4)
  expect(layoutsFor('gaming').map((l) => l.id)).toContain('facecam-top')
  expect(layoutsFor('auto').length).toBe(LAYOUTS.length)
})
