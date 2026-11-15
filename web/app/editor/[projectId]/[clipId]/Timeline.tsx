'use client'
import { useRef } from 'react'
import { fmtDuration } from '@/lib/clips'
import type { Word } from '@/lib/mock'

const MIN_LEN = 5
export const SPEAKER_COLORS = ['#F26B5B', '#5B8DF2', '#3FA796', '#E2B33C']

/** view = fixed window (the original clip plus context) so the scale doesn't shift while dragging. */
export function Timeline({ trim, view, words, t, onTrim, onSeek }: {
  trim: { start: number; end: number }; view: { start: number; end: number }; words: Word[]; t: number
  onTrim: (trim: { start: number; end: number }) => void; onSeek: (t: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { start: v0, end: v1 } = view
  const x = (s: number) => `${((s - v0) / (v1 - v0)) * 100}%`
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return v0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (v1 - v0)
  }
  const drag = (edge: 'start' | 'end', e: React.PointerEvent) => {
    e.stopPropagation()
    const move = (ev: PointerEvent) => {
      const s = Math.round(timeAt(ev.clientX) * 10) / 10 // clamped to view by timeAt
      onTrim(edge === 'start' ? { ...trim, start: Math.min(s, trim.end - MIN_LEN) } : { ...trim, end: Math.max(s, trim.start + MIN_LEN) })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const runs = words.reduce<{ speaker: number; s: number; e: number }[]>((acc, w) => {
    const last = acc[acc.length - 1]
    if (last && last.speaker === (w.speaker ?? 0)) last.e = w.e
    else acc.push({ speaker: w.speaker ?? 0, s: w.s, e: w.e })
    return acc
  }, [])

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-cf">
      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{fmtDuration(trim.start)}</span><span>{fmtDuration(trim.end - trim.start)} clip</span><span>{fmtDuration(trim.end)}</span>
      </div>
      <div ref={ref} className="relative h-10 cursor-pointer select-none rounded-lg bg-muted" onPointerDown={(e) => onSeek(timeAt(e.clientX))}>
        {words.map((w, i) => <span key={i} className="absolute top-3 h-4 w-px bg-muted-foreground/30" style={{ left: x(w.s) }} />)}
        <div className="absolute inset-y-0 rounded-lg border-2 border-cf-accent bg-cf-accent/10" style={{ left: x(trim.start), width: `calc(${x(trim.end)} - ${x(trim.start)})` }}>
          <span role="slider" aria-label="Trim start" aria-valuenow={trim.start} tabIndex={0} onPointerDown={(e) => drag('start', e)}
            className="absolute -left-1.5 inset-y-0 w-3 cursor-ew-resize rounded bg-cf-accent" />
          <span role="slider" aria-label="Trim end" aria-valuenow={trim.end} tabIndex={0} onPointerDown={(e) => drag('end', e)}
            className="absolute -right-1.5 inset-y-0 w-3 cursor-ew-resize rounded bg-cf-accent" />
        </div>
        <span className="pointer-events-none absolute -inset-y-1 w-0.5 rounded bg-foreground" style={{ left: x(t) }} />
      </div>
      <div className="relative h-2.5" aria-label="Speaker track">
        {runs.map((r, i) => <span key={i} className="absolute inset-y-0 rounded-full" style={{ left: x(r.s), width: `calc(${x(r.e)} - ${x(r.s)})`, background: SPEAKER_COLORS[r.speaker % 4] }} title={`Speaker ${r.speaker + 1}`} />)}
      </div>
    </div>
  )
}
