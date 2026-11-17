'use client'
import Link from 'next/link'
import { BrandControls } from '@/components/cf/BrandControls'
import { Field } from '@/components/cf/Field'
import { PanelPreview } from '@/components/cf/PanelPreview'
import { Switch } from '@/components/ui/switch'
import type { PanelProps } from './types'

export function BrandingPanel({ state, set, preview, real }: PanelProps) {
  const hasBumpers = !!(state.brand.introPath || state.brand.outroPath)
  return (
    <div className="flex flex-col gap-6">
      <Field label="Watermark on this clip" inline><Switch aria-label="Watermark on this clip" checked={state.watermarkOn} onCheckedChange={(watermarkOn) => set({ watermarkOn })} /></Field>
      <BrandControls value={state.brand} onChange={(brand) => set({ brand })} />
      {real && (
        <div className="flex flex-col gap-1">
          <Field label="Intro & outro" inline><Switch aria-label="Intro & outro" checked={state.bumpers && hasBumpers} disabled={!hasBumpers} onCheckedChange={(bumpers) => set({ bumpers })} /></Field>
          <p className="text-xs text-muted-foreground">{hasBumpers ? 'Added to the exported file (not shown in this preview).' : 'Upload an intro or outro in Settings → Brand kit.'}</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Changes here apply to this clip only. Your logo and defaults live in <Link className="underline" href="/settings/brand">Settings → Brand kit</Link>.</p>
      <PanelPreview>{preview}</PanelPreview>
    </div>
  )
}
