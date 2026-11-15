'use client'
import { Copy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyText } from '@/lib/copy'
import type { MockClip } from '@/lib/mock'
import { ScoreBadge } from './ScoreBadge'

const DIMS: [keyof Omit<MockClip['breakdown'], 'extra'>, string][] = [
  ['hook', 'Hook (first 3s)'], ['emotion', 'Emotional impact'], ['value', 'Value / shareability'], ['pacing', 'Pacing & clarity'], ['trend', 'Trend relevance (estimate)'],
]

function Field({ label, text, children }: { label: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="ml-auto" />
        <Tooltip><TooltipTrigger asChild><span><Button size="icon-xs" variant="ghost" disabled aria-label={`Regenerate ${label}`}><RefreshCw /></Button></span></TooltipTrigger><TooltipContent>Regenerate arrives in Phase 3</TooltipContent></Tooltip>
        <Button size="icon-xs" variant="ghost" aria-label={`Copy ${label}`} onClick={() => copyText(text, `${label} copied`)}><Copy /></Button>
      </div>
      {children ?? <p className="text-sm">{text}</p>}
    </div>
  )
}

export function ClipDetails({ clip }: { clip: MockClip }) {
  const extras = Object.entries(clip.breakdown.extra ?? {})
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3"><ScoreBadge score={clip.score} className="h-9 min-w-12 text-base" /><p className="text-sm text-muted-foreground">{clip.reason}</p></div>
      <div className="flex flex-col gap-2">
        {[...DIMS, ...extras.map(([k]) => [k, k[0].toUpperCase() + k.slice(1)] as const)].map(([k, label]) => {
          const v = (clip.breakdown as unknown as Record<string, number>)[k] ?? clip.breakdown.extra?.[k] ?? 0
          return (
            <div key={k} className="flex items-center gap-3 text-xs">
              <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-cf-accent" style={{ width: `${v}%` }} /></span>
              <span className="w-7 text-right font-medium tabular-nums">{v}</span>
            </div>
          )
        })}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{clip.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      <Field label="Titles" text={clip.titles.join('\n')}>
        <ol className="space-y-1 text-sm">{clip.titles.map((t) => <li key={t} className="rounded-lg bg-muted px-2.5 py-1.5">{t}</li>)}</ol>
      </Field>
      <Field label="YouTube Shorts description" text={clip.descriptions.shorts} />
      <Field label="TikTok description" text={clip.descriptions.tiktok} />
      <Field label="Reels description" text={clip.descriptions.reels} />
      <Field label="Hashtags" text={clip.hashtags.join(' ')}>
        <div className="flex flex-wrap gap-1.5">{clip.hashtags.map((h) => <span key={h} className="rounded-md bg-muted px-2 py-0.5 text-xs">{h}</span>)}</div>
      </Field>
    </div>
  )
}
