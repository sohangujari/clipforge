'use client'
import { Field, Section } from '@/components/cf/Field'
import { LayoutThumb } from '@/components/cf/LayoutThumb'
import { PanelPreview } from '@/components/cf/PanelPreview'
import { Segmented } from '@/components/cf/Segmented'
import { layoutsFor } from '@/lib/layouts'
import { cn } from '@/lib/utils'
import type { PanelProps } from './types'

export function LayoutPanel({ state, set, project, preview }: PanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <Section title={`Layouts for ${project.contentType}`}>
        <div className="grid grid-cols-3 gap-2">
          {layoutsFor(project.contentType).map((l) => (
            <button key={l.id} type="button" data-testid="layout-card" data-layout={l.id} aria-pressed={state.layoutId === l.id} onClick={() => set({ layoutId: l.id })}
              className={cn('flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all duration-150', state.layoutId === l.id ? 'bg-card shadow-cf ring-2 ring-cf-accent' : 'hover:bg-card/60')}>
              <LayoutThumb layout={l} className="w-full" />
              <span className="text-center text-[11px] font-medium leading-tight">{l.label}</span>
            </button>
          ))}
        </div>
      </Section>
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
