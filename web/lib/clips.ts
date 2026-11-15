export type ScoreTone = 'green' | 'amber' | 'gray'

export function scoreTone(score: number): ScoreTone {
  return score >= 80 ? 'green' : score >= 60 ? 'amber' : 'gray'
}

type Sortable = { score: number; startSec: number; endSec: number }
export type ClipSort = 'score' | 'duration' | 'time'

export function sortClips<T extends Sortable>(clips: T[], by: ClipSort, dir: 'asc' | 'desc' = 'desc'): T[] {
  const key = (c: T) => (by === 'score' ? c.score : by === 'duration' ? c.endSec - c.startSec : c.startSec)
  const sign = dir === 'desc' ? -1 : 1
  return [...clips].sort((a, b) => sign * (key(a) - key(b)) || a.startSec - b.startSec)
}

export function fmtDuration(sec: number): string {
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
