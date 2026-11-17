'use client'
import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Clock, Film, Loader2, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtDuration } from '@/lib/clips'
import { cn } from '@/lib/utils'

export interface CardData {
  id: string; title: string; href: string; status: string; contentType: string
  durationSec?: number; thumbnailUrl?: string; gradient?: string; progress?: number; stage?: string
  clipCount?: number; demo?: boolean
}

const STATUS: Record<string, { label: string; cls: string }> = {
  ready: { label: 'Ready', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  processing: { label: 'Processing', cls: 'bg-cf-accent/15 text-cf-accent' },
  queued: { label: 'Queued', cls: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400' },
  failed: { label: 'Failed', cls: 'bg-cf-accent/15 text-cf-accent' },
  cancelled: { label: 'Cancelled', cls: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400' },
}
const STAGE_LABEL: Record<string, string> = { importing: 'Importing', chat: 'Chat', preparing: 'Preparing', transcribing: 'Transcribing', romanizing: 'Hinglish', signals: 'Listening', analyzing: 'Finding clips', searching: 'Searching' }

export function ProjectCard({ p, onDelete }: { p: CardData; onDelete?: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const s = STATUS[p.status] ?? STATUS.queued
  return (
    <Link href={p.href} data-testid="project-card" className="group relative overflow-hidden rounded-xl bg-card shadow-cf transition-transform duration-150 hover:-translate-y-0.5">
      <div className="relative aspect-video bg-muted" style={p.thumbnailUrl ? undefined : { background: p.gradient ?? 'linear-gradient(135deg,#3f3f46,#71717a)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" />}
        {p.demo && <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Demo</span>}
        {p.durationSec ? <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">{fmtDuration(p.durationSec)}</span> : null}
        {p.status === 'processing' && <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30"><div className="h-full bg-cf-accent transition-[width] duration-200" style={{ width: `${(p.progress ?? 0) * 100}%` }} /></div>}
      </div>
      <div className="flex flex-col gap-2 p-3.5">
        <h3 className="line-clamp-1 pr-6 text-sm font-semibold">{p.title}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium', s.cls)}>
            {p.status === 'processing' && <Loader2 className="size-3 animate-spin" />}
            {p.status === 'failed' && <AlertCircle className="size-3" />}
            {p.status === 'queued' && <Clock className="size-3" />}
            {p.status === 'cancelled' && <XCircle className="size-3" />}
            {p.status === 'processing' && p.stage ? `${STAGE_LABEL[p.stage] ?? p.stage} ${Math.round((p.progress ?? 0) * 100)}%` : s.label}
          </span>
          {p.clipCount ? <span className="inline-flex items-center gap-1"><Film className="size-3" />{p.clipCount} clips</span> : null}
          <span className="ml-auto capitalize">{p.contentType}</span>
        </div>
      </div>
      {onDelete && (
        <div className="absolute bottom-[3.25rem] right-2 flex items-center gap-1" onClick={(e) => e.preventDefault()}>
          {confirm ? (
            <span className="flex items-center gap-1 rounded-lg bg-card p-1 text-xs shadow-cf">
              Delete?
              <Button size="xs" variant="destructive" onClick={onDelete}>Yes</Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>No</Button>
            </span>
          ) : (
            <Button size="icon-xs" variant="secondary" aria-label={`Delete ${p.title}`} className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setConfirm(true)}>
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </Link>
  )
}
