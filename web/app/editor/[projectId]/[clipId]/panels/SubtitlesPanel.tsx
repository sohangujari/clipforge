'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CfSlider } from '@/components/cf/CfSlider'
import { ColorInput, Field, Section } from '@/components/cf/Field'
import { PanelPreview } from '@/components/cf/PanelPreview'
import { Segmented } from '@/components/cf/Segmented'
import { SubtitleLine } from '@/components/cf/SubtitleLine'
import { builtinPresets, type SubtitleStyle } from '@/lib/subtitle-presets'
import { cn } from '@/lib/utils'
import type { PanelProps } from './types'

export const FONTS = ['Montserrat', 'Anton', 'Poppins', 'Inter', 'Bebas Neue', 'Courier Prime', 'Geist']
const SAMPLE = ['THIS', 'IS', 'THE', 'PART'].map((w, i) => ({ w, s: i, e: i + 1 }))
const ANIMS = [['highlight', 'Word highlight'], ['pop', 'Pop / bounce'], ['fade', 'Fade'], ['slide', 'Slide'], ['typewriter', 'Typewriter'], ['none', 'None']] as const

function PresetGallery({ presets, value, onPick }: { presets: SubtitleStyle[]; value: string; onPick: (p: SubtitleStyle) => void }) {
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 600); return () => clearInterval(t) }, [])
  return (
    <div className="grid grid-cols-2 gap-2">
      {presets.map((p) => {
        const big = { ...p, sizePx: p.sizePx * 2.6, wordsPerLine: 2 }
        const words = SAMPLE.slice((Math.floor(tick / 2) % 2) * 2, (Math.floor(tick / 2) % 2) * 2 + 2)
        return (
          <button key={p.id} type="button" aria-pressed={value === p.id} onClick={() => onPick(p)}
            className={cn('flex flex-col overflow-hidden rounded-xl text-left transition-all duration-150', value === p.id ? 'ring-2 ring-cf-accent' : 'hover:opacity-90')}>
            <span className="flex h-16 items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 [container-type:inline-size]">
              <SubtitleLine style={big} words={words} active={tick % 2} />
            </span>
            <span className="bg-card px-2 py-1.5 text-xs font-medium">{p.name}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SubtitlesPanel({ state, set, preview }: PanelProps) {
  const s = state.style
  const st = (patch: Partial<SubtitleStyle>) => set({ style: { ...s, ...patch } })
  const [custom, setCustom] = useState<SubtitleStyle[]>([])
  const [name, setName] = useState('')

  useEffect(() => { fetch('/api/settings/subtitlePresets').then((r) => r.json()).then((v) => setCustom(v.custom ?? [])).catch(() => {}) }, [])

  const savePreset = async () => {
    const n = name.trim()
    if (!n) return toast.error('Name the preset first')
    const preset = { ...s, id: `custom-${Date.now().toString(36)}`, name: n }
    const cur = await fetch('/api/settings/subtitlePresets').then((r) => r.json())
    const res = await fetch('/api/settings/subtitlePresets', { method: 'PUT', body: JSON.stringify({ ...cur, custom: [...cur.custom, preset] }) })
    if (!res.ok) return toast.error("Couldn't save preset")
    setCustom([...custom, preset]); setName(''); st({ id: preset.id, name: n }); toast.success(`Saved “${n}”`)
  }

  return (
    <div className="flex flex-col gap-6">
      <Field label="Subtitles on this clip" inline><Switch aria-label="Subtitles on this clip" checked={state.subtitlesOn} onCheckedChange={(subtitlesOn) => set({ subtitlesOn })} /></Field>
      <Section title="Presets"><PresetGallery presets={[...builtinPresets, ...custom]} value={s.id} onPick={(p) => set({ style: p })} /></Section>

      <Section title="Text">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Font">
            <Select value={s.font} onValueChange={(font) => st({ font })}>
              <SelectTrigger className="w-full" aria-label="Font"><SelectValue /></SelectTrigger>
              <SelectContent>{FONTS.map((f) => <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Case">
            <Segmented aria-label="Letter case" size="sm" value={s.case} onChange={(c) => st({ case: c })}
              options={[{ value: 'none', label: 'Aa' }, { value: 'upper', label: 'AA' }, { value: 'lower', label: 'aa' }]} />
          </Field>
        </div>
        <CfSlider label="Size" min={24} max={140} unit="px" value={s.sizePx} onChange={(sizePx) => st({ sizePx })} />
        <CfSlider label="Weight" min={100} max={900} step={100} value={s.weight} onChange={(weight) => st({ weight })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Text colour"><ColorInput label="Text colour" value={s.color} onChange={(color) => st({ color })} /></Field>
          <Field label="Active word"><ColorInput label="Active word colour" value={s.activeColor} onChange={(activeColor) => st({ activeColor })} /></Field>
        </div>
      </Section>

      <Section title="Outline, shadow & box">
        <div className="flex items-end gap-3">
          <Field label="Stroke"><ColorInput label="Stroke colour" value={s.stroke.color} onChange={(color) => st({ stroke: { ...s.stroke, color } })} /></Field>
          <CfSlider className="flex-1" label="Stroke width" min={0} max={20} unit="px" value={s.stroke.width} onChange={(width) => st({ stroke: { ...s.stroke, width } })} />
        </div>
        <Field label="Shadow" inline><Switch aria-label="Shadow" checked={!!s.shadow} onCheckedChange={(on) => st({ shadow: on ? { color: '#000000', blur: 8, x: 0, y: 4 } : null })} /></Field>
        {s.shadow && <CfSlider label="Shadow blur" min={0} max={40} unit="px" value={s.shadow.blur} onChange={(blur) => st({ shadow: { ...s.shadow!, blur } })} />}
        <Field label="Background box" inline><Switch aria-label="Background box" checked={!!s.box} onCheckedChange={(on) => st({ box: on ? { color: '#000000', opacity: 70, radius: 12, padding: 14 } : null })} /></Field>
        {s.box && (
          <>
            <Field label="Box colour"><ColorInput label="Box colour" value={s.box.color} onChange={(color) => st({ box: { ...s.box!, color } })} /></Field>
            <CfSlider label="Box opacity" min={0} max={100} unit="%" value={s.box.opacity} onChange={(opacity) => st({ box: { ...s.box!, opacity } })} />
            <CfSlider label="Corner radius" min={0} max={40} unit="px" value={s.box.radius} onChange={(radius) => st({ box: { ...s.box!, radius } })} />
            <CfSlider label="Padding" min={0} max={40} unit="px" value={s.box.padding} onChange={(padding) => st({ box: { ...s.box!, padding } })} />
          </>
        )}
      </Section>

      <Section title="Layout & animation">
        <CfSlider label="Words per line" min={1} max={8} value={s.wordsPerLine} onChange={(wordsPerLine) => st({ wordsPerLine })} />
        <Field label="Lines on screen" inline>
          <Segmented aria-label="Lines on screen" size="sm" value={String(s.lines) as '1' | '2'} onChange={(v) => st({ lines: Number(v) as 1 | 2 })}
            options={[{ value: '1', label: '1' }, { value: '2', label: '2' }]} />
        </Field>
        <Field label="Animation">
          <Select value={s.animation} onValueChange={(v) => st({ animation: v as SubtitleStyle['animation'] })}>
            <SelectTrigger className="w-full" aria-label="Animation"><SelectValue /></SelectTrigger>
            <SelectContent>{ANIMS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Position">
          <Segmented aria-label="Subtitle position" value={s.position} onChange={(position) => st({ position })}
            options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
        </Field>
        <CfSlider label="Vertical offset" min={-40} max={40} unit="%" value={s.offsetPct} onChange={(offsetPct) => st({ offsetPct })} />
        <Field label="Auto emoji (AI)" inline><Switch aria-label="Auto emoji" checked={s.emoji} onCheckedChange={(emoji) => st({ emoji })} /></Field>
        <Field label="Keyword emphasis (AI)" inline><Switch aria-label="Keyword emphasis" checked={s.emphasis} onCheckedChange={(emphasis) => st({ emphasis })} /></Field>
      </Section>

      <Section title="Save as preset">
        <div className="flex gap-2">
          <Input value={name} maxLength={60} placeholder="Preset name" aria-label="Preset name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && savePreset()} />
          <Button variant="secondary" onClick={savePreset}><Save /> Save</Button>
        </div>
      </Section>

      <Section title="Transcript">
        <p className="text-xs text-muted-foreground">Fix any word — the preview updates instantly. Timing edits arrive with the full editor.</p>
        <div className="flex flex-wrap gap-1">
          {state.words.map((w, i) => (
            <input key={i} aria-label={`Word ${i + 1}`} value={w.w} size={Math.max(2, w.w.length)}
              onChange={(e) => set({ words: state.words.map((x, j) => (j === i ? { ...x, w: e.target.value } : x)) })}
              className="rounded-md bg-card px-1.5 py-1 text-sm shadow-cf outline-none focus:ring-2 focus:ring-cf-accent" />
          ))}
        </div>
      </Section>
      <PanelPreview>{preview}</PanelPreview>
    </div>
  )
}
