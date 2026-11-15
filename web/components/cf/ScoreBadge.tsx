import { scoreTone } from '@/lib/clips'
import { cn } from '@/lib/utils'

const tones = {
  green: 'bg-emerald-600 text-white',
  amber: 'bg-amber-400 text-amber-950',
  gray: 'bg-zinc-500 text-white',
}

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const tone = scoreTone(score)
  return (
    <span data-testid="score-badge" data-tone={tone} className={cn('inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums', tones[tone], className)}>
      {Math.round(score)}
    </span>
  )
}
