import Link from 'next/link'
import { AlertCircle, Clock, Film, Loader2 } from 'lucide-react'
import { fmtDuration } from '@/lib/clips'
import type { MockProject } from '@/lib/mock'
import { cn } from '@/lib/utils'

const STATUS = {
  ready: { label: 'Ready', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  processing: { label: 'Processing', cls: 'bg-cf-accent/15 text-cf-accent' },
  queued: { label: 'Queued', cls: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400' },
  failed: { label: 'Failed', cls: 'bg-cf-accent/15 text-cf-accent' },
} as const

export function ProjectCard({ p }: { p: MockProject }) {
  const href = p.status === 'ready' ? `/projects/${p.id}/clips` : `/projects/${p.id}/processing`
  const s = STATUS[p.status]
  return (
    <Link href={href} className="group overflow-hidden rounded-xl bg-card shadow-cf transition-transform duration-150 hover:-translate-y-0.5">
      <div className="relative aspect-video" style={{ background: p.thumbnail }}>
        <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">{fmtDuration(p.durationSec)}</span>
      </div>
      <div className="flex flex-col gap-2 p-3.5">
        <h3 className="line-clamp-1 text-sm font-semibold">{p.title}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium', s.cls)}>
            {p.status === 'processing' && <Loader2 className="size-3 animate-spin" />}
            {p.status === 'failed' && <AlertCircle className="size-3" />}
            {p.status === 'queued' && <Clock className="size-3" />}
            {s.label}
          </span>
          {p.status === 'ready' && <span className="inline-flex items-center gap-1"><Film className="size-3" />{p.clipCount} clips</span>}
          <span className="ml-auto capitalize">{p.contentType}</span>
        </div>
      </div>
    </Link>
  )
}
