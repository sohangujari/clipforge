'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FileVideo, Link2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CONTENT_TYPE_INFO } from '@/lib/content-types'
import type { SettingValue } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { CfSlider } from './CfSlider'
import { Segmented } from './Segmented'

type Defaults = SettingValue<'defaults'>
const ACCEPT = '.mp4,.mov,.mkv,.webm'
export const LANGUAGES = [['auto', 'Auto-detect'], ['en', 'English'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['fr', 'French'], ['de', 'German'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']] as const
export const TONE_LABELS = { neutral: 'Neutral', educational: 'Educational', funny: 'Funny', motivational: 'Motivational', dramatic: 'Dramatic' } as const

const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`)

export function NewProjectForm() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [drag, setDrag] = useState(false)
  const [d, setD] = useState<Defaults | null>(null)

  useEffect(() => {
    fetch('/api/settings/defaults').then((r) => r.json()).then(setD).catch(() => toast.error("Couldn't load defaults"))
  }, [])

  const pick = (f?: File) => {
    if (!f) return
    if (!/\.(mp4|mov|mkv|webm)$/i.test(f.name)) return toast.error('Use an MP4, MOV, MKV or WebM file')
    setFile(f); setUrl('')
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!file && !url.trim()) return toast.error('Add a video file or paste a link')
    if (url && !/^https?:\/\/\S+$/i.test(url.trim())) return toast.error('That link doesn’t look like a URL')
    toast('Processing arrives in Phase 2 — showing a demo')
    router.push('/projects/p-processing/processing')
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-6">
        <section className="rounded-xl bg-card p-5 shadow-cf">
          <h2 className="mb-3 font-semibold">Video</h2>
          {file ? (
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
              <FileVideo className="size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{fmtSize(file.size)}</p></div>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove file" onClick={() => setFile(null)}><X /></Button>
            </div>
          ) : (
            <button type="button" onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]) }}
              className={cn('flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors duration-150',
                drag ? 'border-cf-accent bg-cf-accent/5' : 'hover:bg-muted/60')}>
              <Upload className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">Drop a video here or click to browse</span>
              <span className="text-xs text-muted-foreground">MP4, MOV, MKV or WebM</span>
            </button>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} />
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          <label className="flex items-center gap-2 rounded-lg border bg-background px-3">
            <Link2 className="size-4 text-muted-foreground" />
            <Input value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) setFile(null) }}
              placeholder="Paste a YouTube, Twitch, Kick or Vimeo link" className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" />
          </label>
        </section>

        <section className="rounded-xl bg-card p-5 shadow-cf">
          <h2 className="mb-3 font-semibold">Content type</h2>
          <div role="radiogroup" aria-label="Content type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONTENT_TYPE_INFO.map((t) => {
              const active = d?.contentType === t.value
              return (
                <button key={t.value} type="button" role="radio" aria-checked={active} onClick={() => d && setD({ ...d, contentType: t.value })}
                  className={cn('flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all duration-150 [&_svg]:size-5',
                    active ? 'border-transparent bg-card shadow-cf ring-2 ring-cf-accent' : 'bg-muted/50 hover:bg-muted')}>
                  <span className={active ? 'text-cf-accent' : 'text-muted-foreground'}>{t.icon}</span>
                  <span className="text-sm font-medium leading-tight">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.hint}</span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-5 self-start rounded-xl bg-card p-5 shadow-cf">
        <h2 className="font-semibold">Clip settings</h2>
        {!d ? <div className="h-64 animate-pulse rounded-lg bg-muted" /> : (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Number of clips</span>
              <Segmented aria-label="Number of clips" value={d.clipCount === 'auto' ? 'auto' : 'custom'}
                options={[{ value: 'auto', label: 'Auto' }, { value: 'custom', label: 'Custom' }]}
                onChange={(v) => setD({ ...d, clipCount: v === 'auto' ? 'auto' : 8 })} />
              {d.clipCount !== 'auto' && <CfSlider label="Clips" min={3} max={20} value={d.clipCount} onChange={(v) => setD({ ...d, clipCount: v })} />}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Clip length</span>
              <Segmented aria-label="Clip length" value={d.lengthRange.join('-')}
                options={[{ value: '15-60', label: '15–60s' }, { value: '30-90', label: '30–90s' }, { value: '60-180', label: '1–3m' }]}
                onChange={(v) => setD({ ...d, lengthRange: v.split('-').map(Number) as Defaults['lengthRange'] })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-2"><span className="text-xs font-medium text-muted-foreground">Language</span>
                <Select value={d.language} onValueChange={(v) => setD({ ...d, language: v })}>
                  <SelectTrigger className="w-full" aria-label="Language"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANGUAGES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-2"><span className="text-xs font-medium text-muted-foreground">Tone</span>
                <Select value={d.tone} onValueChange={(v) => setD({ ...d, tone: v as Defaults['tone'] })}>
                  <SelectTrigger className="w-full" aria-label="Tone"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TONE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </label>
            </div>
          </>
        )}
        <Button type="submit" size="lg" className="mt-1">Create clips</Button>
      </aside>
    </form>
  )
}
