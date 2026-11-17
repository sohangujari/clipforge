'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, Copy, Download, Laugh, Pencil, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { fmtDuration } from '@/lib/clips'
import { copyText } from '@/lib/copy'
import type { MockClip } from '@/lib/mock'
import { cn } from '@/lib/utils'
import { ScoreBadge } from './ScoreBadge'

/** Works for demo clips (MockClip) and real ones (ClipView adds status/thumbnail/signals/source). */
export type CardClip = MockClip & { status?: string; thumbnailUrl?: string; signalsUsed?: string[]; source?: string; query?: string }

const SIGNAL_LABEL: Record<string, string> = { laughter: 'Laughter', applause: 'Applause', cheering: 'Cheering', scream: 'Shouting', loud: 'High energy', chat: 'Chat spike' }

export function ClipCard({ clip, thumbnail, previewSrc, onOpen, onKeep, onDelete }: {
  clip: CardClip; thumbnail: string; previewSrc?: string; onOpen: () => void; onKeep?: () => void; onDelete?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [hover, setHover] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const play = () => {
    setHover(true)
    const v = video.current
    if (v) { v.currentTime = clip.startSec; v.play().catch(() => {}) }
  }
  const stop = () => { setHover(false); video.current?.pause() }

  return (
    <div data-testid="clip-card" data-clip-id={clip.id} className="group flex flex-col overflow-hidden rounded-xl bg-card shadow-cf">
      <button type="button" onClick={onOpen} onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop}
        className="relative aspect-[9/16] max-h-80 w-full overflow-hidden text-left" style={{ background: thumbnail }} aria-label={`Open ${clip.titles[0]}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {clip.thumbnailUrl && <img src={clip.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" />}
        {previewSrc && (
          <video ref={video} src={`${previewSrc}#t=${clip.startSec},${clip.endSec}`} muted playsInline preload="none"
            onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= clip.endSec) e.currentTarget.currentTime = clip.startSec }}
            className={cn('absolute inset-0 size-full object-cover transition-opacity duration-150', hover ? 'opacity-100' : 'opacity-0')} />
        )}
        {!clip.thumbnailUrl && (
          <span className="absolute inset-x-3 bottom-10 text-center text-sm font-extrabold uppercase text-white [text-shadow:0_2px_6px_rgb(0_0_0/0.8)]">
            {clip.transcript.slice(0, 3).map((w) => w.w).join(' ')}
          </span>
        )}
        <ScoreBadge score={clip.score} className="absolute left-2 top-2 shadow-sm" />
        <span className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {clip.signalsUsed?.map((s) => (
            <span key={s} className="flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white"><Laugh className="size-3" />{SIGNAL_LABEL[s] ?? s}</span>
          ))}
        </span>
        <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">{fmtDuration(clip.endSec - clip.startSec)}</span>
      </button>
      <div className="flex flex-1 flex-col gap-2 p-3">
        {clip.source === 'search' && clip.query && (
          <span className="flex items-center gap-1 self-start rounded-md bg-cf-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-cf-accent"><Search className="size-3" />Found for “{clip.query}”</span>
        )}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{clip.titles[0]}</h3>
        <div className="mt-auto flex items-center gap-1">
          <Button size="sm" asChild className="flex-1"><Link href={`/editor/${clip.projectId}/${clip.id}`}><Pencil /> Edit</Link></Button>
          {onKeep && (
            <Button size="icon-sm" variant="ghost" aria-label={clip.status === 'kept' ? 'Kept' : 'Keep'} title={clip.status === 'kept' ? 'Kept — future runs learn from this' : 'Keep — teaches ClipForge your taste'} onClick={onKeep}>
              {clip.status === 'kept' ? <BookmarkCheck className="text-cf-accent" /> : <Bookmark />}
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" aria-label="Copy title, description and hashtags"
            onClick={() => copyText(`${clip.titles[0]}\n\n${clip.descriptions.shorts}\n\n${clip.hashtags.join(' ')}`, 'Title, description and hashtags copied')}><Copy /></Button>
          {onDelete ? (
            confirm ? (
              <span className="flex items-center gap-1 text-xs">
                <Button size="xs" variant="destructive" onClick={onDelete}>Yes</Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>No</Button>
              </span>
            ) : <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => setConfirm(true)}><Trash2 /></Button>
          ) : (
            <Button size="icon-sm" variant="ghost" aria-label="Download" onClick={() => toast('Rendering arrives in Phase 4')}><Download /></Button>
          )}
        </div>
      </div>
    </div>
  )
}
