'use client'
import { Download, FileArchive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ExportButton } from '@/components/cf/ExportButton'
import { Field, Section } from '@/components/cf/Field'
import { PanelPreview } from '@/components/cf/PanelPreview'
import { Segmented } from '@/components/cf/Segmented'
import type { PanelProps } from './types'

export function ExportPanel({ state, set, preview, project, clip, real, saveEdit }: PanelProps) {
  const saveNow = async () => { await saveEdit?.() } // the export renders exactly what the preview shows
  const demo = () => toast('This is a demo project — import a video to export clips')
  return (
    <div className="flex flex-col gap-6">
      <Section title="Export">
        <Field label="Resolution">
          <Segmented aria-label="Resolution" value={state.resolution} onChange={(resolution) => set({ resolution })}
            options={[{ value: '1080p', label: '1080p' }, { value: '720p', label: '720p' }]} />
        </Field>
        <Field label="Format" inline><span className="text-sm font-medium">MP4 (H.264)</span></Field>
        <Field label="Aspect ratio" inline><span className="text-sm font-medium">{state.aspect}</span></Field>
        {real ? (
          <>
            <ExportButton clipId={clip.id} projectId={project.id} resolution={state.resolution} before={saveNow} />
            <ExportButton projectId={project.id} resolution={state.resolution} zip variant="secondary" before={saveNow} />
            <p className="text-xs text-muted-foreground">Rendered on this device from the original video. The ZIP uses each clip’s own saved settings.</p>
          </>
        ) : (
          <>
            <Button onClick={demo}><Download /> Export clip</Button>
            <Button variant="secondary" onClick={demo}><FileArchive /> Download all (ZIP)</Button>
          </>
        )}
      </Section>
      <PanelPreview>{preview}</PanelPreview>
    </div>
  )
}
