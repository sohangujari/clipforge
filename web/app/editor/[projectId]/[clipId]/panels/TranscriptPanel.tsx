'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Scissors, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { heard } from '@/lib/cuts'
import { cutOut, extendTo, inTrim, MIN_CLIP, restore, sentences, trimTo } from '@/lib/transcript'
import { cn } from '@/lib/utils'
import type { PanelProps } from './types'

/** Transcript-first editing: click a word to jump there; select words to trim the clip to them or cut them out; add the
 * sentences around the clip with +; double-click a word to fix what Whisper heard (the subtitles change with it). */
export function TranscriptPanel({ state, set, t, seek, keep, speakers }: PanelProps) {
  const { words, trim, cuts } = state
  const [sel, setSel] = useState<[number, number] | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const dragging = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const sents = useMemo(() => sentences(words), [words])
  const [a, b] = sel ? [Math.min(...sel), Math.max(...sel)] : [-1, -1]
  const active = words.findIndex((w) => w.s <= t && t < w.e)
  const multi = speakers.length > 1

  useEffect(() => { // keep the spoken word in view while it plays
    box.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useEffect(() => {
    const up = () => { dragging.current = false }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  const doTrim = () => {
    const next = trimTo(words, a, b)
    if (next.end - next.start < MIN_CLIP) return toast('Select at least a second of speech')
    set({ trim: next, cuts: cuts.filter(([s, e]) => s >= next.start && e <= next.end) }) // hand cuts outside the new clip go
    setSel(null)
  }
  const doCut = () => {
    const r = cutOut(words, trim, cuts, a, b)
    if (!r) return toast("That would cut the whole clip — select less, or use 'Trim to selection'")
    set(r); setSel(null)
  }
  const handCut = sel && cuts.some(([s, e]) => e >= words[a].s && s <= words[b].e)
  const onKey = (e: React.KeyboardEvent) => {
    if (editing !== null) return
    if (sel && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); doCut() }
    if (e.key === 'Escape') setSel(null)
  }
  const fix = (i: number, text: string) => {
    const w = text.trim()
    setEditing(null)
    if (w && w !== words[i].w) set({ words: words.map((x, k) => (k === i ? { ...x, w: w.slice(0, 100) } : x)) })
  }

  if (!words.length) return <p className="text-sm text-muted-foreground">This clip has no transcript.</p>

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKey}>
      <p className="text-xs text-muted-foreground">Click a word to jump there. Drag or shift-click to select words, then trim the clip to them or cut them out. Double-click a word to fix it.</p>
      <div className="sticky top-14 z-10 flex min-h-9 flex-wrap items-center gap-1.5 rounded-xl bg-cf-panel/95 py-1 backdrop-blur">
        {sel ? (
          <>
            <Button size="sm" onClick={doTrim}>Trim to selection</Button>
            <Button size="sm" variant="secondary" onClick={doCut}><Scissors /> Cut</Button>
            {handCut && <Button size="sm" variant="secondary" onClick={() => { set({ cuts: restore(cuts, words[a].s, words[b].e) }); setSel(null) }}><Undo2 /> Restore</Button>}
            <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={() => setSel(null)}><X /></Button>
          </>
        ) : <span className="text-xs text-muted-foreground">{cuts.length ? `${cuts.length} part${cuts.length > 1 ? 's' : ''} cut by hand` : 'Nothing selected'}</span>}
      </div>
      <div ref={box} data-testid="transcript" tabIndex={0} className="flex select-none flex-col gap-2.5 text-[15px] leading-relaxed outline-none">
        {sents.map(([i0, i1], n) => {
          const inside = words.slice(i0, i1 + 1).some((w) => inTrim(w, trim))
          const before = !inside && words[i1].e <= trim.start
          const sp = words[i0].speaker
          const showSpeaker = multi && sp !== undefined && (n === 0 || words[sents[n - 1][0]].speaker !== sp)
          return (
            <p key={i0} className={cn('rounded-lg', !inside && 'text-muted-foreground/60')}>
              {showSpeaker && <span className="mr-1.5 text-[11px] font-semibold" style={{ color: speakers[sp]?.color }}>{speakers[sp]?.name}</span>}
              {!inside && (
                <button type="button" aria-label={before ? 'Add this sentence to the start' : 'Add this sentence to the end'} title="Add to the clip"
                  onClick={() => set({ trim: extendTo(words, trim, [i0, i1]) })}
                  className="mr-1 inline-flex size-4 translate-y-0.5 items-center justify-center rounded bg-muted text-foreground hover:bg-cf-accent hover:text-white">
                  <Plus className="size-3" />
                </button>
              )}
              {words.slice(i0, i1 + 1).map((w, k) => {
                const i = i0 + k
                const isIn = inTrim(w, trim)
                const gone = isIn && !heard(keep, w)
                const byHand = gone && cuts.some(([s, e]) => w.s >= s - 0.01 && w.e <= e + 0.01)
                return (
                  <Fragment key={i}>
                    {k > 0 && ' '}
                    {editing === i ? (
                      <input autoFocus aria-label="Fix word" defaultValue={w.w} size={Math.max(2, w.w.length)}
                        className="rounded bg-card px-1 outline outline-2 outline-cf-accent"
                        onBlur={(e) => fix(i, e.currentTarget.value)}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null) }} />
                    ) : (
                      <span data-testid="transcript-word" data-i={i} data-active={i === active} data-cut={gone || undefined}
                        className={cn('cursor-pointer rounded px-0.5 transition-colors duration-100',
                          gone && 'line-through decoration-2 opacity-50', byHand && 'decoration-cf-accent',
                          i === active && 'bg-cf-accent/20', i >= a && i <= b && 'bg-cf-accent text-white opacity-100')}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          dragging.current = true
                          setSel(e.shiftKey && sel ? [sel[0], i] : [i, i])
                          if (!e.shiftKey) seek(w.s)
                        }}
                        onPointerEnter={() => { if (dragging.current && sel) setSel([sel[0], i]) }}
                        onDoubleClick={() => { setSel(null); setEditing(i) }}>
                        {w.w}
                      </span>
                    )}
                  </Fragment>
                )
              })}
            </p>
          )
        })}
      </div>
    </div>
  )
}
