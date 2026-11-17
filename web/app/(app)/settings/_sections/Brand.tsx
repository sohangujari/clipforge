'use client'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Film, ImageUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandControls } from '@/components/cf/BrandControls'
import { Section } from '@/components/cf/Field'
import type { BrandKit } from '@/lib/editor'
import { useSetting } from '@/lib/use-setting'
import { SaveBar } from './SaveBar'

export function BrandSection() {
  const { value: b, setValue, save, saving } = useSetting<BrandKit>('brandKit', 'Brand kit')
  const input = useRef<HTMLInputElement>(null)
  if (!b) return <div className="h-96 animate-pulse rounded-xl bg-muted" />

  const upload = async (file?: File) => {
    if (!file) return
    const fd = new FormData(); fd.append('file', file)
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
      const png = await svgToPng(file).catch(() => null) // the export needs a PNG: FFmpeg can't read SVG
      if (!png) return toast.error("Couldn't read that SVG — try a PNG")
      fd.append('png', png, 'logo.png')
    }
    const res = await fetch('/api/uploads/logo', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(j.error ?? 'Upload failed')
    setValue({ ...b, logoPath: j.path, logoPngPath: j.pngPath })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-cf">
        <Section title="Logo">
          <div className="flex items-center gap-4">
            <div className="flex size-20 items-center justify-center rounded-xl bg-dotgrid">
              {b.logoPath
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/files/${b.logoPath}`} alt="Your logo" className="max-h-16 max-w-16" />
                : <ImageUp className="size-6 text-muted-foreground" />}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>Upload PNG or SVG</Button>
                {b.logoPath && <Button size="sm" variant="ghost" aria-label="Remove logo" onClick={() => setValue({ ...b, logoPath: undefined })}><Trash2 /></Button>}
              </div>
              <p className="text-xs text-muted-foreground">Transparent background works best. Max 5 MB.</p>
            </div>
            <input ref={input} type="file" accept="image/png,image/svg+xml" hidden aria-label="Upload logo" onChange={(e) => upload(e.target.files?.[0])} />
          </div>
        </Section>
      </section>
      <section className="rounded-xl bg-card p-5 shadow-cf"><BrandControls value={b} onChange={setValue} /></section>
      <section className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-cf">
        <h3 className="text-sm font-semibold">Intro & outro</h3>
        <p className="text-sm text-muted-foreground">Short videos joined before and after every exported clip. Keep them to a few seconds — viewers swipe away from slow starts. MP4, MOV or WebM, max 100 MB.</p>
        <div className="grid grid-cols-2 gap-3">
          {(['introPath', 'outroPath'] as const).map((key) => <Bumper key={key} label={key === 'introPath' ? 'Intro' : 'Outro'} path={b[key]}
            onChange={(path) => setValue({ ...b, [key]: path })} />)}
        </div>
      </section>
      <SaveBar saving={saving} onSave={() => save()} />
    </div>
  )
}

function Bumper({ label, path, onChange }: { label: string; path?: string; onChange: (path?: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const upload = async (file?: File) => {
    if (!file) return
    setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/uploads/bumper', { method: 'POST', body: fd }).catch(() => null)
    const j = await res?.json().catch(() => ({}))
    setBusy(false)
    if (!res?.ok) return toast.error(j?.error ?? 'Upload failed')
    onChange(j.path)
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {path
        ? <video src={`/api/files/${path}`} controls muted playsInline preload="metadata" aria-label={`${label} video`} className="aspect-video w-full rounded-lg bg-black object-contain" />
        : <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">None</div>}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}><Film /> {busy ? 'Uploading…' : path ? 'Replace' : `Upload ${label.toLowerCase()}`}</Button>
        {path && <Button size="sm" variant="ghost" aria-label={`Remove ${label.toLowerCase()}`} onClick={() => onChange(undefined)}><Trash2 /></Button>}
      </div>
      <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm" hidden aria-label={`Upload ${label.toLowerCase()}`} onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  )
}

/** Renders an SVG to a 1024-px-wide PNG (transparent background) in the browser. */
async function svgToPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const w = 1024, h = Math.max(1, Math.round((w * (img.naturalHeight || 512)) / (img.naturalWidth || 1024)))
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob'))), 'image/png'))
  } finally { URL.revokeObjectURL(url) }
}
