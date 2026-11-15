'use client'
import Link from 'next/link'
import { Copy, Download, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { fmtDuration } from '@/lib/clips'
import { copyText } from '@/lib/copy'
import type { MockClip } from '@/lib/mock'
import { ScoreBadge } from './ScoreBadge'

export function ClipCard({ clip, thumbnail, onOpen }: { clip: MockClip; thumbnail: string; onOpen: () => void }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl bg-card shadow-cf">
      <button type="button" onClick={onOpen} className="relative aspect-[9/16] max-h-80 w-full overflow-hidden text-left" style={{ background: thumbnail }} aria-label={`Open ${clip.titles[0]}`}>
        <span className="absolute inset-x-3 bottom-10 text-center text-sm font-extrabold uppercase text-white [text-shadow:0_2px_6px_rgb(0_0_0/0.8)]">{clip.transcript.slice(0, 3).map((w) => w.w).join(' ')}</span>
        <ScoreBadge score={clip.score} className="absolute left-2 top-2 shadow-sm backdrop-blur" />
        <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">{fmtDuration(clip.endSec - clip.startSec)}</span>
      </button>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{clip.titles[0]}</h3>
        <div className="mt-auto flex items-center gap-1">
          <Button size="sm" asChild className="flex-1"><Link href={`/editor/${clip.projectId}/${clip.id}`}><Pencil /> Edit</Link></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Copy title, description and hashtags"
            onClick={() => copyText(`${clip.titles[0]}\n\n${clip.descriptions.shorts}\n\n${clip.hashtags.join(' ')}`, 'Title, description and hashtags copied')}><Copy /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Download" onClick={() => toast('Rendering arrives in Phase 4')}><Download /></Button>
        </div>
      </div>
    </div>
  )
}
