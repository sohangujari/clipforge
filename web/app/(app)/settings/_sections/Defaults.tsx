'use client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CfSlider } from '@/components/cf/CfSlider'
import { Field } from '@/components/cf/Field'
import { LANGUAGES, TONE_LABELS } from '@/components/cf/NewProjectForm'
import { Segmented } from '@/components/cf/Segmented'
import { VocabularyInput } from '@/components/cf/VocabularyInput'
import { CONTENT_TYPE_INFO } from '@/lib/content-types'
import type { SettingValue } from '@/lib/settings'
import { useSetting } from '@/lib/use-setting'
import { SaveBar } from './SaveBar'

type D = SettingValue<'defaults'>
const WHISPER = [['large-v3-turbo', 'Large v3 Turbo — best (≈1.6 GB)'], ['medium', 'Medium (≈1.5 GB, slower)'], ['small', 'Small — fastest (≈0.5 GB)']] as const

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="w-full" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  )
}

export function DefaultsSection() {
  const { value: d, setValue, save, saving } = useSetting<D>('defaults', 'Defaults')
  if (!d) return <div className="h-96 animate-pulse rounded-xl bg-muted" />
  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-5 rounded-xl bg-card p-5 shadow-cf sm:grid-cols-2">
        <Field label="Number of clips">
          <Segmented aria-label="Number of clips" value={d.clipCount === 'auto' ? 'auto' : 'custom'}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'custom', label: 'Custom' }]} onChange={(v) => setValue({ ...d, clipCount: v === 'auto' ? 'auto' : 8 })} />
          {d.clipCount !== 'auto' && <CfSlider min={3} max={20} value={d.clipCount} label="Clips" onChange={(clipCount) => setValue({ ...d, clipCount })} />}
        </Field>
        <Field label="Clip length">
          <Segmented aria-label="Clip length" value={d.lengthRange.join('-')} onChange={(v) => setValue({ ...d, lengthRange: v.split('-').map(Number) as D['lengthRange'] })}
            options={[{ value: '15-60', label: '15–60s' }, { value: '30-90', label: '30–90s' }, { value: '60-180', label: '1–3m' }]} />
        </Field>
        <Pick label="Content type" value={d.contentType} options={CONTENT_TYPE_INFO.map((c) => [c.value, c.label] as const)} onChange={(contentType) => setValue({ ...d, contentType })} />
        <Pick label="Language" value={d.language} options={LANGUAGES} onChange={(language) => setValue({ ...d, language })} />
        <Pick label="Tone" value={d.tone} options={Object.entries(TONE_LABELS) as [D['tone'], string][]} onChange={(tone) => setValue({ ...d, tone })} />
        <Pick label="Transcription model" value={d.whisperModel} options={WHISPER} onChange={(whisperModel) => setValue({ ...d, whisperModel })} />
        <Field label="Captions script (Hindi)">
          <Segmented aria-label="Captions script" value={d.captionScript} onChange={(captionScript) => setValue({ ...d, captionScript })}
            options={[{ value: 'native', label: 'Native' }, { value: 'hinglish', label: 'Hinglish' }]} />
        </Field>
        <Field label="Custom words (names, brands — spelled exactly in captions)" className="sm:col-span-2">
          <VocabularyInput value={d.vocabulary} onChange={(vocabulary) => setValue({ ...d, vocabulary })} />
        </Field>
      </section>
      <SaveBar saving={saving} onSave={() => save()} />
    </div>
  )
}
