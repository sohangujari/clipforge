'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Section } from '@/components/cf/Field'
import { applyTemplate, templateFrom, type LayoutTemplate } from '@/lib/layout-templates'
import { useSetting } from '@/lib/use-setting'
import { LayoutThumb } from '@/components/cf/LayoutThumb'
import { PanelPreview } from '@/components/cf/PanelPreview'
import { Segmented } from '@/components/cf/Segmented'
import { LAYOUTS, layoutsFor } from '@/lib/layouts'
import { SPEAKER_LAYOUTS } from '@/lib/people'
import { cn } from '@/lib/utils'
import type { PanelProps } from './types'

/** Layouts the export renders today, and the phase that brings each of the others (they need speaker/facecam/screen detection). */
const SOON: Partial<Record<string, number>> = { 'facecam-top': 7, 'facecam-bottom': 7, pip: 7, 'gameplay-only': 7, 'reaction-stack': 7, 'screen-zoom': 8 }

/** Save this clip's framing, subtitle spot and watermark spot as a template, or apply a saved one. */
function Templates({ state, set }: Pick<PanelProps, 'state' | 'set'>) {
  const { value, save, saving } = useSetting<LayoutTemplate[]>('layoutTemplates', 'Layout templates')
  const [name, setName] = useState('')
  return (
    <Section title="Layout templates">
      {!!value?.length && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => <Button key={t.id} size="sm" variant="secondary" onClick={() => set(applyTemplate(state, t))}>{t.name}</Button>)}
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault()
        if (!value || !name.trim()) return
        save([...value, templateFrom(state, name.trim(), crypto.randomUUID())]).then(() => setName(''))
      }}>
        <Input aria-label="Template name" value={name} maxLength={60} placeholder="e.g. Podcast 2-cam" onChange={(e) => setName(e.target.value)} />
        <Button type="submit" size="sm" disabled={saving || !name.trim() || !value}>Save</Button>
      </form>
    </Section>
  )
}

/** Why a speaker layout can't be picked for this video, if it can't. */
function unavailable(id: string, people: PanelProps['people']): string | undefined {
  if (!(SPEAKER_LAYOUTS as readonly string[]).includes(id)) return undefined
  if (!people) return 'Find clips again to detect speakers'
  if (id !== 'active-speaker' && !people.multi) return 'Needs 2+ people on screen together'
}

export function LayoutPanel({ state, set, project, preview, real, people }: PanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <Section title={`Layouts for ${project.contentType}`}>
        <div className="grid grid-cols-3 gap-2">
          {(real ? [...LAYOUTS.filter((l) => !SOON[l.id] && !layoutsFor(project.contentType).includes(l)), ...layoutsFor(project.contentType)] : layoutsFor(project.contentType)).map((l) => {
            const soon = real ? SOON[l.id] : undefined
            const why = real && !soon ? unavailable(l.id, people) : undefined
            return (
              <button key={l.id} type="button" data-testid="layout-card" data-layout={l.id} aria-pressed={state.layoutId === l.id} disabled={!!soon || !!why}
                onClick={() => set({ layoutId: l.id })}
                className={cn('flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                  state.layoutId === l.id ? 'bg-card shadow-cf ring-2 ring-cf-accent' : 'hover:bg-card/60')}>
                <LayoutThumb layout={l} className="w-full" />
                <span className="text-center text-[11px] font-medium leading-tight">{l.label}</span>
                {(soon || why) && <span className="text-center text-[10px] leading-tight text-muted-foreground">{soon ? `Coming in Phase ${soon}` : why}</span>}
              </button>
            )
          })}
        </div>
      </Section>
      {real && <Templates state={state} set={set} />}
      <Section title="Platform safe zones">
        <Field label="Show where app buttons and captions will cover the video">
          <Segmented aria-label="Safe zones" size="sm" value={state.safeZone} onChange={(safeZone) => set({ safeZone })}
            options={[{ value: 'off', label: 'Off' }, { value: 'tiktok', label: 'TikTok' }, { value: 'reels', label: 'Reels' }, { value: 'shorts', label: 'Shorts' }]} />
        </Field>
      </Section>
      <PanelPreview>{preview}</PanelPreview>
    </div>
  )
}
