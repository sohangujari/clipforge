'use client'
import { Download, FileArchive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, Section } from '@/components/cf/Field'
import { PanelPreview } from '@/components/cf/PanelPreview'
import { Segmented } from '@/components/cf/Segmented'
import type { PanelProps } from './types'

export function ExportPanel({ state, set, preview }: PanelProps) {
  const soon = () => toast('Rendering arrives in Phase 4')
  return (
    <div className="flex flex-col gap-6">
      <Section title="Export">
        <Field label="Resolution">
          <Segmented aria-label="Resolution" value={state.resolution} onChange={(resolution) => set({ resolution })}
            options={[{ value: '1080p', label: '1080p' }, { value: '720p', label: '720p' }]} />
        </Field>
        <Field label="Format" inline><span className="text-sm font-medium">MP4 (H.264)</span></Field>
        <Field label="Aspect ratio" inline><span className="text-sm font-medium">{state.aspect}</span></Field>
        <Button onClick={soon}><Download /> Export clip</Button>
        <Button variant="secondary" onClick={soon}><FileArchive /> Download all as ZIP</Button>
      </Section>
      <PanelPreview>{preview}</PanelPreview>
    </div>
  )
}
