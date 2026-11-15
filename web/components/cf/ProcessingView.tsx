'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STAGES, type MockProject } from '@/lib/mock'
import { cn } from '@/lib/utils'

const LABELS = { importing: 'Importing', transcribing: 'Transcribing', detecting: 'Detecting layout', analyzing: 'Finding highlights', reframing: 'Reframing' }

export function ProcessingView({ project }: { project: MockProject }) {
  const startIdx = project.stage ? STAGES.indexOf(project.stage) : 0
  const [progress, setProgress] = useState(project.status === 'queued' ? 0 : (startIdx + (project.progress ?? 0)) / STAGES.length)
  const failed = project.status === 'failed'

  useEffect(() => {
    if (failed) return
    const t = setInterval(() => setProgress((p) => Math.min(1, p + 0.01)), 120) // mock progress
    return () => clearInterval(t)
  }, [failed])

  const current = Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length))
  const done = progress >= 1

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-xl bg-card p-6 shadow-cf">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{failed ? 'Processing failed' : done ? 'All done' : `${LABELS[STAGES[current]]}…`}</span>
        <span className="tabular-nums text-muted-foreground">{Math.round(progress * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full transition-[width] duration-200', failed ? 'bg-cf-accent/50' : 'bg-cf-accent')} style={{ width: `${progress * 100}%` }} />
      </div>
      <ol className="flex flex-col gap-3">
        {STAGES.map((s, i) => {
          const state = failed && i === current ? 'error' : done || i < current ? 'done' : i === current ? 'active' : 'todo'
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className={cn('flex size-6 items-center justify-center rounded-full',
                state === 'done' && 'bg-emerald-500/15 text-emerald-600', state === 'active' && 'bg-cf-accent/15 text-cf-accent',
                state === 'error' && 'bg-cf-accent text-white', state === 'todo' && 'bg-muted text-muted-foreground')}>
                {state === 'done' ? <Check className="size-3.5" /> : state === 'active' ? <Loader2 className="size-3.5 animate-spin" /> : state === 'error' ? <AlertCircle className="size-3.5" /> : <span className="text-xs">{i + 1}</span>}
              </span>
              <span className={state === 'todo' ? 'text-muted-foreground' : 'font-medium'}>{LABELS[s]}</span>
            </li>
          )
        })}
      </ol>
      {failed && <p className="rounded-lg bg-cf-accent/10 p-3 text-sm text-cf-accent">{project.error}</p>}
      <div className="flex justify-end gap-2">
        {!done && !failed && <Button variant="outline" onClick={() => toast('Cancel arrives in Phase 2')}>Cancel</Button>}
        {failed && <Button variant="outline" onClick={() => toast('Retry arrives in Phase 2')}>Retry</Button>}
        {done && <Button asChild><Link href="/projects/p-podcast/clips">View clips</Link></Button>}
      </div>
    </div>
  )
}
