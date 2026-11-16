'use client'
import { useEffect, useRef } from 'react'

/** Calls save(value) `delay` ms after value stops changing (skips the first value). Returns flush() for "save now". */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, delay = 800): () => Promise<void> {
  const first = useRef(true), timer = useRef<ReturnType<typeof setTimeout>>(undefined), pending = useRef<T | null>(null)
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })
  useEffect(() => {
    if (first.current) { first.current = false; return }
    pending.current = value
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { pending.current = null; saveRef.current(value).catch(() => {}) }, delay)
    return () => clearTimeout(timer.current)
  }, [value, delay])
  // Leaving the editor (unmount) or the page (pagehide) right after a change: save it instead of dropping the timer.
  useEffect(() => {
    const now = () => { if (pending.current !== null) { const v = pending.current; pending.current = null; saveRef.current(v).catch(() => {}) } }
    window.addEventListener('pagehide', now)
    return () => { window.removeEventListener('pagehide', now); now() }
  }, [])
  return async () => {
    clearTimeout(timer.current)
    if (pending.current !== null) { const v = pending.current; pending.current = null; await saveRef.current(v) }
  }
}
