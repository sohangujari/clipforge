'use client'
import { useRef } from 'react'
import { toast } from 'sonner'
import { ImageUp, Trash2 } from 'lucide-react'
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
    const res = await fetch('/api/uploads/logo', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(j.error ?? 'Upload failed')
    setValue({ ...b, logoPath: j.path })
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
      <section className="flex flex-col gap-2 rounded-xl bg-card p-5 shadow-cf">
        <h3 className="text-sm font-semibold">Intro & outro</h3>
        <p className="text-sm text-muted-foreground">Short video bumpers added to every clip — coming in Phase 4.</p>
      </section>
      <SaveBar saving={saving} onSave={() => save()} />
    </div>
  )
}
