'use client'
import { ClipDetails } from '@/components/cf/ClipDetails'
import { Field, Section } from '@/components/cf/Field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { PanelProps } from './types'

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Field label={label} inline><Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} /></Field>
}

export function AiPanel({ clip, state, set, real }: PanelProps) {
  return (
    <div className="flex flex-col gap-6">
      {real && (
        <Section title="Auto edits">
          <Toggle label="Remove filler words (um, uh)" checked={state.removeFillers} onChange={(removeFillers) => set({ removeFillers })} />
          <Toggle label="Remove long pauses" checked={state.removePauses} onChange={(removePauses) => set({ removePauses })} />
          <Toggle label="Auto-zoom on key words" checked={state.autoZoom && state.layoutId !== 'wide-blur'} disabled={state.layoutId === 'wide-blur'}
            onChange={(autoZoom) => set({ autoZoom })} />
          <Toggle label="Hook line at the start" checked={state.hook.on} onChange={(on) => set({ hook: { ...state.hook, on } })} />
          {state.hook.on && (
            <Input aria-label="Hook text" value={state.hook.text} maxLength={70} placeholder="A line that stops the scroll"
              onChange={(e) => set({ hook: { ...state.hook, text: e.target.value } })} />
          )}
          <p className="text-xs text-muted-foreground">The preview plays the clip with these edits, exactly as it will export. Cut parts are shaded on the timeline.</p>
        </Section>
      )}
      <ClipDetails clip={clip} />
    </div>
  )
}
