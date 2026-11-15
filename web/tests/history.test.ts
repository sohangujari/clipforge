import { expect, test } from 'vitest'
import { historyReducer, initHistory } from '@/lib/history'

const set = (value: string) => ({ type: 'set' as const, value })

test('undo and redo', () => {
  let h = initHistory('a')
  h = historyReducer(historyReducer(h, set('b')), set('c'))
  h = historyReducer(historyReducer(h, { type: 'undo' }), { type: 'undo' })
  expect(h.present).toBe('a')
  h = historyReducer(h, { type: 'redo' })
  expect(h.present).toBe('b')
  h = historyReducer(h, set('d'))
  expect(h.future).toEqual([])
})

test('past capped at 100', () => {
  let h = initHistory(0 as unknown as string)
  for (let i = 1; i <= 150; i++) h = historyReducer(h, set(String(i)))
  expect(h.past.length).toBe(100)
})

test('undo with empty past is a no-op', () => {
  const h = initHistory('a')
  expect(historyReducer(h, { type: 'undo' })).toBe(h)
  expect(historyReducer(h, { type: 'redo' })).toBe(h)
})
