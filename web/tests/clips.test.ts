import { expect, test } from 'vitest'
import { scoreTone } from '@/lib/clips'

test('scoreTone thresholds', () => {
  expect(scoreTone(100)).toBe('green'); expect(scoreTone(80)).toBe('green')
  expect(scoreTone(79)).toBe('amber'); expect(scoreTone(60)).toBe('amber')
  expect(scoreTone(59)).toBe('gray'); expect(scoreTone(0)).toBe('gray')
})

import { sortClips } from '@/lib/clips'
import { getMockClips, mockProjects } from '@/lib/mock'

const c = (id: string, score: number, startSec: number, endSec = startSec + 30) => ({ id, score, startSec, endSec })

test('sortClips by score desc, ties by startSec, non-mutating', () => {
  const input = [c('a', 50, 10), c('b', 90, 30), c('c', 90, 5)]
  const out = sortClips(input, 'score')
  expect(out.map((x) => x.id)).toEqual(['c', 'b', 'a'])
  expect(input.map((x) => x.id)).toEqual(['a', 'b', 'c'])
})

test('sortClips by duration and time', () => {
  const input = [c('a', 50, 10, 70), c('b', 90, 30, 45)]
  expect(sortClips(input, 'duration').map((x) => x.id)).toEqual(['a', 'b'])
  expect(sortClips(input, 'time', 'asc').map((x) => x.id)).toEqual(['a', 'b'])
})

test('mock projects: ready ones have ≥8 clips covering all tones', () => {
  const ready = mockProjects.filter((p) => p.status === 'ready')
  expect(ready.length).toBeGreaterThanOrEqual(2)
  expect(mockProjects.map((p) => p.status)).toEqual(expect.arrayContaining(['ready', 'processing', 'failed', 'queued']))
  for (const p of ready) {
    const clips = getMockClips(p.id)
    expect(clips.length).toBeGreaterThanOrEqual(8)
    expect(new Set(clips.map((x) => scoreTone(x.score)))).toEqual(new Set(['green', 'amber', 'gray']))
  }
})

import { fmtDuration } from '@/lib/clips'
test('fmtDuration shows hours past 60 minutes', () => {
  expect(fmtDuration(65)).toBe('1:05')
  expect(fmtDuration(5832)).toBe('1:37:12')
  expect(fmtDuration(59.6)).toBe('1:00')
})
