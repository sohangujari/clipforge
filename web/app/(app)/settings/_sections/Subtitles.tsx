'use client'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubtitleLine } from '@/components/cf/SubtitleLine'
import { builtinPresets, type SubtitleStyle } from '@/lib/subtitle-presets'
import { useSetting } from '@/lib/use-setting'
import { cn } from '@/lib/utils'

type Presets = { custom: SubtitleStyle[]; defaultId: string }
const SAMPLE = [{ w: 'Your', s: 0, e: 1 }, { w: 'clip', s: 1, e: 2 }]

export function SubtitlesSection() {
  const { value, save } = useSetting<Presets>('subtitlePresets', 'Subtitle presets')
  if (!value) return <div className="h-96 animate-pulse rounded-xl bg-muted" />
  const all = [...builtinPresets, ...value.custom]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {all.map((p) => {
        const isDefault = value.defaultId === p.id
        const custom = value.custom.some((c) => c.id === p.id)
        return (
          <div key={p.id} data-testid={`preset-${p.id}`} className={cn('flex flex-col overflow-hidden rounded-xl bg-card shadow-cf', isDefault && 'ring-2 ring-cf-accent')}>
            <div className="flex h-20 items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 [container-type:inline-size]">
              <SubtitleLine style={{ ...p, sizePx: p.sizePx * 2.6 }} words={SAMPLE} active={1} />
            </div>
            <div className="flex items-center gap-1 p-2.5">
              <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
              {isDefault
                ? <span className="rounded-md bg-cf-accent/15 px-1.5 py-0.5 text-xs font-medium text-cf-accent">Default</span>
                : <Button size="xs" variant="ghost" onClick={() => save({ ...value, defaultId: p.id })}>Set default</Button>}
              {custom && (
                <Button size="icon-xs" variant="ghost" aria-label={`Delete ${p.name}`}
                  onClick={() => save({ custom: value.custom.filter((c) => c.id !== p.id), defaultId: isDefault ? 'bold-pop' : value.defaultId })}><Trash2 /></Button>
              )}
            </div>
          </div>
        )
      })}
      <p className="col-span-full text-sm text-muted-foreground">Create presets in the editor’s Subtitles panel with “Save as preset”.</p>
    </div>
  )
}
