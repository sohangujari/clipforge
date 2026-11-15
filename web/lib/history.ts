export interface History<T> { past: T[]; present: T; future: T[] }
export type HistoryAction<T> = { type: 'set'; value: T } | { type: 'undo' } | { type: 'redo' }

const CAP = 100

export const initHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] })

export function historyReducer<T>(h: History<T>, a: HistoryAction<T>): History<T> {
  switch (a.type) {
    case 'set':
      return { past: [...h.past, h.present].slice(-CAP), present: a.value, future: [] }
    case 'undo':
      if (!h.past.length) return h
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
    case 'redo':
      if (!h.future.length) return h
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
  }
}
