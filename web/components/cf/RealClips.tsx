'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Film, Loader2, RefreshCw, Search, Settings, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ClipView } from '@/lib/clip-views'
import type { ProjectView } from '@/lib/projects'
import { ClipsView } from './ClipsView'
import { EmptyState } from './EmptyState'
import type { RegenField } from './ClipDetails'

const GRADIENT = 'linear-gradient(135deg,#3f3f46,#71717a)'
const busy = (p: ProjectView) => p.status === 'queued' || p.status === 'processing'

/** Real clips for one project: live progress for Find clips again / Search, keep/delete, regenerate. */
export function RealClips({ initial }: { initial: ProjectView }) {
  const [p, setP] = useState(initial)
  const [clips, setClips] = useState<ClipView[] | null>(null)
  const [taste, setTaste] = useState(0)
  const [query, setQuery] = useState('')

  const load = useCallback(() => fetch(`/api/projects/${initial.id}/clips`).then((x) => x.json())
    .then((r) => { setClips(r.clips); setTaste(r.tasteCount) }).catch(() => toast.error("Couldn't load clips")), [initial.id])
  useEffect(() => {
    let alive = true
    // Next can revive this page with old state; re-read the project so a running job shows its progress.
    fetch(`/api/projects/${initial.id}`).then((x) => x.json()).then((v) => { if (alive && v.id) setP(v) }).catch(() => {})
    fetch(`/api/projects/${initial.id}/clips`).then((x) => x.json()).then((r) => { if (alive) { setClips(r.clips); setTaste(r.tasteCount) } }).catch(() => {})
    return () => { alive = false }
  }, [initial.id])

  const running = busy(p)
  useEffect(() => {
    if (!running) return
    const es = new EventSource(`/api/projects/${initial.id}/events`)
    es.onmessage = (e) => {
      const v: ProjectView = JSON.parse(e.data)
      setP(v)
      if (!busy(v)) { es.close(); load() }
    }
    return () => es.close()
  }, [running, initial.id, load])

  const start = async (path: 'analyze' | 'search', body?: object) => {
    const res = await fetch(`/api/projects/${p.id}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
    const j = await res.json()
    if (!res.ok) return toast.error(j.error ?? 'Something went wrong')
    setP(j)
  }
  const setStatus = async (c: ClipView, status: 'kept' | 'deleted') => {
    if (status === 'kept' && c.status === 'kept') return
    const res = await fetch(`/api/clips/${c.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    if (!res.ok) return toast.error("Couldn't update the clip")
    setClips((cs) => (status === 'deleted' ? cs!.filter((x) => x.id !== c.id) : cs!.map((x) => (x.id === c.id ? { ...x, status } : x))))
    setTaste((n) => n + 1)
  }
  const regenerate = async (c: ClipView, field: RegenField) => {
    const res = await fetch(`/api/clips/${c.id}/regenerate`, { method: 'POST', body: JSON.stringify({ field }) })
    const j = await res.json()
    if (!res.ok) { toast.error(j.error ?? "Couldn't regenerate"); return }
    setClips((cs) => cs!.map((x) => (x.id === c.id ? j : x)))
  }

  const label = p.jobType === 'search' ? 'Searching' : 'Finding clips'
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) start('search', { query }) }}>
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} disabled={running}
              placeholder="Find a moment… e.g. “where they talk about blind dates”" className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" />
          </label>
          <Button type="submit" disabled={running || query.trim().length < 3}>Search</Button>
        </form>
        <Button variant="secondary" disabled={running} onClick={() => start('analyze')}><RefreshCw /> Find clips again</Button>
      </div>

      {running && (
        <div className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-cf" role="status">
          <div className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin text-cf-accent" /><span className="font-medium">{p.message ?? label}…</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{Math.round(p.progress * 100)}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-cf-accent transition-[width] duration-300" style={{ width: `${p.progress * 100}%` }} /></div>
        </div>
      )}
      {!running && p.warning && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"><TriangleAlert className="size-4 shrink-0" />{p.warning}
          {/Settings → AI/.test(p.warning) && <Link href="/settings/ai" className="ml-auto flex items-center gap-1 font-medium underline"><Settings className="size-3.5" />Open settings</Link>}</p>
      )}

      {!clips ? <div className="h-64 animate-pulse rounded-xl bg-muted" /> : clips.length === 0 && !running ? (
        <EmptyState icon={<Film />} title="No clips yet" body="No moments were picked from this video yet. Find clips to try again."
          action={<Button onClick={() => start('analyze')}>Find clips</Button>} />
      ) : (
        <ClipsView clips={clips} thumbnail={GRADIENT} previewSrc={`/api/files/media/${p.id}/proxy.mp4`} tasteCount={taste}
          onKeep={(c) => setStatus(c as ClipView, 'kept')} onDelete={(c) => setStatus(c as ClipView, 'deleted')}
          onRegenerate={(c, f) => regenerate(c as ClipView, f)} />
      )}
    </div>
  )
}
