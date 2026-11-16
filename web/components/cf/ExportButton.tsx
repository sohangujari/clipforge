'use client'
import { useEffect, useState } from 'react'
import { Download, FileArchive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { JobStatus } from '@/lib/exports'

/**
 * Starts an export (one clip, or every clip as a ZIP), shows its progress, then the download link.
 * before() runs first — the editor uses it to save the latest edit so the export matches the preview.
 */
export function ExportButton({ clipId, projectId, resolution, zip = false, before, variant = 'default' }: {
  clipId?: string; projectId: string; resolution: '1080p' | '720p'; zip?: boolean; before?: () => Promise<void>; variant?: 'default' | 'secondary'
}) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [s, setS] = useState<JobStatus | null>(null)

  useEffect(() => {
    if (!jobId) return
    let stop = false
    const poll = async () => {
      const r = await fetch(`/api/jobs/${jobId}`).then((x) => (x.ok ? x.json() : null)).catch(() => null)
      if (stop || !r) return
      setS(r)
      if (r.status === 'failed') toast.error(r.error ?? 'Export failed')
      if (!['done', 'failed', 'cancelled'].includes(r.status)) setTimeout(poll, 1000)
    }
    poll()
    return () => { stop = true }
  }, [jobId])

  const start = async () => {
    setS(null); setJobId(null)
    await before?.()
    const r = await fetch(zip ? `/api/projects/${projectId}/export` : `/api/clips/${clipId}/export`, { method: 'POST', body: JSON.stringify({ resolution }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error(j.error ?? 'Export failed')
    setJobId(j.jobId)
  }

  const running = !!jobId && (!s || ['queued', 'running'].includes(s.status))
  const Icon = zip ? FileArchive : Download
  return (
    <div className="flex flex-col gap-2">
      <Button variant={variant} disabled={running} onClick={start}>
        {running ? <Loader2 className="animate-spin" /> : <Icon />}{zip ? 'Download all (ZIP)' : 'Export clip'}
      </Button>
      {running && (
        <div className="flex flex-col gap-1" role="status">
          <span className="text-xs text-muted-foreground">
            {!s || s.status === 'queued' ? 'Waiting for the current job…' : `${s.message ?? 'Rendering'} · ${Math.round(s.progress * 100)}%`}
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-cf-accent transition-[width] duration-300" style={{ width: `${(s?.progress ?? 0) * 100}%` }} /></div>
        </div>
      )}
      {s?.status === 'done' && s.files.map((f) => (
        <a key={f} href={f} download className="flex items-center gap-1.5 text-sm font-medium text-cf-accent underline-offset-2 hover:underline">
          <Download className="size-4" />{zip ? 'Download ZIP' : 'Download MP4'}
        </a>
      ))}
      {s?.status === 'failed' && <span className="text-xs text-cf-accent">{s.error}</span>}
    </div>
  )
}
