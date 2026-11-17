'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, Check, Loader2, TriangleAlert, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProjectView } from '@/lib/projects'
import { cn } from '@/lib/utils'

const STAGES = [['importing', 'Importing'], ['preparing', 'Preparing'], ['transcribing', 'Transcribing'], ['romanizing', 'Hinglish captions'],
  ['signals', 'Listening for reactions'], ['faces', 'Finding faces'], ['speakers', 'Finding who speaks'], ['analyzing', 'Finding clips']] as const

/** Live view of a real project's job over SSE. */
export function LiveProcessing({ initial }: { initial: ProjectView }) {
  const router = useRouter()
  const [p, setP] = useState(initial)
  const [stream, setStream] = useState(0) // bump to reconnect after retry

  useEffect(() => {
    const es = new EventSource(`/api/projects/${initial.id}/events`)
    es.onmessage = (e) => {
      const v: ProjectView = JSON.parse(e.data)
      setP(v)
      // Redirect only from a live update: Next may revive this page with old state (e.g. "ready, 0 clips").
      if (v.status === 'ready') router.push(`/projects/${v.id}/${v.clipCount ? 'clips' : 'transcript'}`)
    }
    es.addEventListener('gone', () => router.push('/'))
    return () => es.close()
  }, [initial.id, router, stream])


  // A job that never starts, or progress that freezes, usually means the worker process isn't running.
  const [workerAlive, setWorkerAlive] = useState(true)
  const waiting = p.status === 'queued' || p.status === 'processing'
  useEffect(() => {
    if (!waiting) return
    const check = () => fetch('/api/system').then((r) => r.json()).then((s) => setWorkerAlive(!!s.workerAlive)).catch(() => {})
    const t = setTimeout(check, 3000), i = setInterval(check, 5000)
    return () => { clearTimeout(t); clearInterval(i) }
  }, [waiting])
  const workerDown = waiting && !workerAlive

  const act = async (what: 'cancel' | 'retry' | 'delete') => {
    const res = await fetch(`/api/projects/${p.id}${what === 'delete' ? '' : `/${what}`}`, { method: what === 'delete' ? 'DELETE' : 'POST' })
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? 'Something went wrong')
    if (what === 'delete') return router.push('/')
    setP(await res.json())
    if (what === 'retry') setStream((n) => n + 1)
  }

  const stages = STAGES.filter(([id]) => (id !== 'romanizing' || p.captionScript === 'hinglish') && (p.jobType === 'ingest' || id === 'signals' || id === 'faces' || id === 'speakers' || id === 'analyzing'))
  const current = stages.findIndex(([id]) => id === p.stage)
  const failed = p.status === 'failed', cancelled = p.status === 'cancelled', active = p.status === 'queued' || p.status === 'processing'
  const headline = failed ? 'Processing failed' : cancelled ? 'Cancelled' : p.status === 'queued' ? 'Waiting to start…'
    : p.status === 'ready' ? 'All done' : `${p.message ?? stages[current]?.[1] ?? 'Working'}…`

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-xl bg-card p-6 shadow-cf">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{headline}</span>
        <span className="tabular-nums text-muted-foreground">{Math.round(p.progress * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(p.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full transition-[width] duration-300', active ? 'bg-cf-accent' : 'bg-cf-accent/40')} style={{ width: `${p.progress * 100}%` }} />
      </div>
      <ol className="flex flex-col gap-3">
        {stages.map(([id, label], i) => {
          const state = p.status === 'ready' || i < current ? 'done' : i === current ? (failed ? 'error' : cancelled ? 'stopped' : 'active') : 'todo'
          return (
            <li key={id} className="flex items-center gap-3 text-sm">
              <span className={cn('flex size-6 items-center justify-center rounded-full',
                state === 'done' && 'bg-emerald-500/15 text-emerald-600', state === 'active' && 'bg-cf-accent/15 text-cf-accent',
                state === 'error' && 'bg-cf-accent text-white', (state === 'todo' || state === 'stopped') && 'bg-muted text-muted-foreground')}>
                {state === 'done' ? <Check className="size-3.5" /> : state === 'active' ? <Loader2 className="size-3.5 animate-spin" />
                  : state === 'error' ? <AlertCircle className="size-3.5" /> : state === 'stopped' ? <XCircle className="size-3.5" /> : <span className="text-xs">{i + 1}</span>}
              </span>
              <span className={state === 'todo' ? 'text-muted-foreground' : 'font-medium'}>{label}</span>
            </li>
          )
        })}
      </ol>
      {workerDown && <p className="rounded-lg bg-cf-accent/10 p-3 text-sm text-cf-accent">The worker isn’t running, so nothing will happen yet. Start ClipForge with <code>npm run dev</code> (it starts both the app and the worker).</p>}
      {p.error && <p className="rounded-lg bg-cf-accent/10 p-3 text-sm text-cf-accent">{p.error}</p>}
      {p.warning && <p className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"><TriangleAlert className="size-4 shrink-0" />{p.warning}</p>}
      <div className="flex justify-end gap-2">
        {active && <Button variant="outline" onClick={() => act('cancel')}>Cancel</Button>}
        {(failed || cancelled) && <><Button variant="ghost" onClick={() => act('delete')}>Delete</Button><Button onClick={() => act('retry')}>Retry</Button></>}
      </div>
    </div>
  )
}
