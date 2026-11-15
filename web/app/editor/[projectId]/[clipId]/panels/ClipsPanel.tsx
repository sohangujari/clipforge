'use client'
import Link from 'next/link'
import { ScoreBadge } from '@/components/cf/ScoreBadge'
import { fmtDuration, sortClips } from '@/lib/clips'
import { cn } from '@/lib/utils'
import type { PanelProps } from './types'

export function ClipsPanel({ clips, clip }: PanelProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {sortClips(clips, 'score').map((c) => (
        <Link key={c.id} href={`/editor/${c.projectId}/${c.id}`}
          className={cn('flex items-center gap-3 rounded-xl p-2.5 transition-colors duration-150', c.id === clip.id ? 'bg-card shadow-cf' : 'hover:bg-card/60')}>
          <ScoreBadge score={c.score} />
          <span className="line-clamp-2 flex-1 text-sm leading-snug">{c.titles[0]}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{fmtDuration(c.endSec - c.startSec)}</span>
        </Link>
      ))}
    </div>
  )
}
