import { expect, test } from 'vitest'
import { chunkAt } from '@/lib/editor'

const W = [
  { w: 'a', s: 0, e: 1 }, { w: 'b', s: 1, e: 2 }, { w: 'c', s: 2, e: 3 },
  { w: 'd', s: 3, e: 4 }, { w: 'e', s: 4, e: 5 },
]

test('chunkAt returns the chunk containing t and the active index', () => {
  expect(chunkAt(W, 2, 0.5)).toEqual({ words: [W[0], W[1]], active: 0 })
  expect(chunkAt(W, 2, 2.5)).toEqual({ words: [W[2], W[3]], active: 0 })
  expect(chunkAt(W, 2, 4.2)).toEqual({ words: [W[4]], active: 0 })
})

test('chunkAt before the first word shows the first chunk, after the last shows the last', () => {
  expect(chunkAt(W, 2, -3)).toEqual({ words: [W[0], W[1]], active: -1 })
  expect(chunkAt(W, 2, 99)).toEqual({ words: [W[4]], active: -1 })
  expect(chunkAt([], 2, 1)).toEqual({ words: [], active: -1 })
})
