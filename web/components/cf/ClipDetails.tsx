'use client'
import { useState } from 'react'
import { Copy, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExportButton } from './ExportButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyText } from '@/lib/copy'
import type { MockClip } from '@/lib/mock'
import { ScoreBadge } from './ScoreBadge'

export type RegenField = 'titles' | 'descriptions' | 'hashtags'
type DetailClip = MockClip & { reasons?: Record<string, string> }

const DIMS: [string, string][] = [
  ['hook', 'Hook (first 3s)'], ['emotion', 'Emotional impact'], ['value', 'Value / shareability'], ['pacing', 'Pacing & clarity'], ['trend', 'Trend (estimate)'],
]

function Field({ label, text, regen, onRegen, children, testId }: {
  label: string; text: string; regen?: RegenField; onRegen?: (f: RegenField) => Promise<void>; children?: React.ReactNode; testId?: string
}) {
  const [busy, setBusy] = useState(false)
  const run = async () => { if (!onRegen || !regen) return; setBusy(true); try { await onRegen(regen) } finally { setBusy(false) } }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="ml-auto" />
        {regen && (onRegen ? (
          <Button size="icon-xs" variant="ghost" aria-label={`Regenerate ${label}`} disabled={busy} onClick={run}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button>
        ) : (
          <Tooltip><TooltipTrigger asChild><span><Button size="icon-xs" variant="ghost" disabled aria-label={`Regenerate ${label}`}><RefreshCw /></Button></span></TooltipTrigger><TooltipContent>Demo clip</TooltipContent></Tooltip>
        ))}
        <Button size="icon-xs" variant="ghost" aria-label={`Copy ${label}`} onClick={() => copyText(text, `${label} copied`)}><Copy /></Button>
      </div>
      <div data-testid={testId}>{children ?? <p className="text-sm">{text}</p>}</div>
    </div>
  )
}

export function ClipDetails({ clip, onRegenerate, tasteCount }: { clip: DetailClip; onRegenerate?: (f: RegenField) => Promise<void>; tasteCount?: number }) {
  const extras = Object.entries(clip.breakdown.extra ?? {})
  const reasons = clip.reasons ?? {}
  const value = (k: string) => (clip.breakdown as unknown as Record<string, number>)[k] ?? clip.breakdown.extra?.[k] ?? 0
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3"><ScoreBadge score={clip.score} className="h-9 min-w-12 text-base" /><p className="text-sm text-muted-foreground">{clip.reason}</p></div>
      {'status' in clip && <ExportButton clipId={clip.id} projectId={clip.projectId} resolution="1080p" />}
      {!!tasteCount && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="size-3.5 text-cf-accent" />Learned from {tasteCount} of your keep/delete choices</p>}
      <div className="flex flex-col gap-2.5">
        {[...DIMS, ...extras.map(([k]) => [k, k[0].toUpperCase() + k.slice(1)] as [string, string])].map(([k, label]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-3 text-xs">
              <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-cf-accent" style={{ width: `${value(k)}%` }} /></span>
              <span className="w-7 text-right font-medium tabular-nums">{value(k)}</span>
            </div>
            {reasons[k] && <p className="pl-[9.75rem] text-xs text-muted-foreground">{reasons[k]}</p>}
          </div>
        ))}
      </div>
      {clip.tips.length > 0 && <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{clip.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
      <Field label="Titles" text={clip.titles.join('\n')} regen="titles" onRegen={onRegenerate} testId="titles-list">
        <ol className="space-y-1 text-sm">{clip.titles.map((t) => <li key={t} className="rounded-lg bg-muted px-2.5 py-1.5">{t}</li>)}</ol>
      </Field>
      <Field label="Descriptions" text={`${clip.descriptions.shorts}\n\n${clip.descriptions.tiktok}\n\n${clip.descriptions.reels}`} regen="descriptions" onRegen={onRegenerate}>
        <div className="space-y-2 text-sm">
          {([['YouTube Shorts', clip.descriptions.shorts], ['TikTok', clip.descriptions.tiktok], ['Reels', clip.descriptions.reels]] as const).map(([p, d]) => (
            <div key={p} className="flex items-start gap-2"><span className="w-24 shrink-0 text-xs text-muted-foreground">{p}</span><p className="flex-1">{d}</p>
              <Button size="icon-xs" variant="ghost" aria-label={`Copy ${p} description`} onClick={() => copyText(d, `${p} description copied`)}><Copy /></Button></div>
          ))}
        </div>
      </Field>
      <Field label="Hashtags" text={clip.hashtags.join(' ')} regen="hashtags" onRegen={onRegenerate}>
        <div className="flex flex-wrap gap-1.5">{clip.hashtags.map((h) => <span key={h} className="rounded-md bg-muted px-2 py-0.5 text-xs">{h}</span>)}</div>
      </Field>
    </div>
  )
}
