'use client'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { BrandKit } from '@/lib/editor'
import { CfSlider } from './CfSlider'
import { ColorInput, Field, Section } from './Field'
import { PositionGrid } from './PositionGrid'

/** Shared by the editor's Branding panel and Settings → Brand kit. */
export function BrandControls({ value: b, onChange }: { value: BrandKit; onChange: (b: BrandKit) => void }) {
  const text = b.text ?? { value: '', font: 'Geist', color: '#FFFFFF', opacity: 70 }
  return (
    <div className="flex flex-col gap-6">
      <Section title="Position">
        <div className="flex items-start gap-4">
          <PositionGrid value={b.position} onChange={(position) => onChange({ ...b, position })} />
          <div className="flex flex-1 flex-col gap-3">
            <CfSlider label="Opacity" min={0} max={100} unit="%" value={b.opacity} onChange={(opacity) => onChange({ ...b, opacity })} />
            <CfSlider label="Size" min={2} max={40} unit="%" value={b.sizePct} onChange={(sizePct) => onChange({ ...b, sizePct })} />
            <CfSlider label="Margin" min={0} max={15} unit="%" value={b.marginPct} onChange={(marginPct) => onChange({ ...b, marginPct })} />
          </div>
        </div>
      </Section>
      <Section title="Text watermark">
        <Field label="Show text" inline>
          <Switch checked={!!b.text} aria-label="Show text watermark" onCheckedChange={(on) => onChange({ ...b, text: on ? text : undefined })} />
        </Field>
        {b.text && (
          <>
            <Input value={text.value} maxLength={60} placeholder="@yourhandle" aria-label="Watermark text" onChange={(e) => onChange({ ...b, text: { ...text, value: e.target.value } })} />
            <div className="flex items-center gap-3">
              <ColorInput label="Text colour" value={text.color} onChange={(color) => onChange({ ...b, text: { ...text, color } })} />
              <CfSlider className="flex-1" min={0} max={100} unit="%" value={text.opacity} label="Text opacity" onChange={(opacity) => onChange({ ...b, text: { ...text, opacity } })} />
            </div>
          </>
        )}
      </Section>
    </div>
  )
}
