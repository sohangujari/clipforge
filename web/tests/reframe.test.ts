import { expect, test } from 'vitest'
import { centerAt, cropRect, outputSize } from '@/lib/reframe'

// Same numbers as worker/tests/test_reframe.py: preview and export must crop identically.
test('centerAt interpolates and clamps', () => {
  const k: [number, number, number][] = [[0, 0.2, 0.5], [2, 0.8, 0.5]]
  expect(centerAt(k, 1)).toEqual([0.5, 0.5])
  expect(centerAt(k, -1)).toEqual([0.2, 0.5])
  expect(centerAt(k, 5)).toEqual([0.8, 0.5])
})

test('cropRect: 9:16 on landscape is even and clamped; matching sources are not cropped', () => {
  expect(cropRect(0.0, 0.5, 1920, 1080, 9 / 16)).toEqual([0, 0, 606, 1080])
  expect(cropRect(1.0, 0.5, 1920, 1080, 9 / 16)).toEqual([1314, 0, 606, 1080])
  expect(cropRect(0.5, 0.5, 1920, 1080, 1)).toEqual([420, 0, 1080, 1080])
  expect(cropRect(0.5, 0.5, 1080, 1920, 9 / 16)).toEqual([0, 0, 1080, 1920])
  expect(cropRect(0.3, 0.5, 1920, 1080, 16 / 9)).toEqual([0, 0, 1920, 1080])
})

test('outputSize per aspect and resolution', () => {
  expect(outputSize('9:16', '1080p')).toEqual({ w: 1080, h: 1920 })
  expect(outputSize('9:16', '720p')).toEqual({ w: 720, h: 1280 })
  expect(outputSize('1:1', '1080p')).toEqual({ w: 1080, h: 1080 })
  expect(outputSize('16:9', '1080p')).toEqual({ w: 1920, h: 1080 })
  expect(outputSize('16:9', '720p')).toEqual({ w: 1280, h: 720 })
})
