'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Cpu, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/cf/Field'
import { ModelPicker } from '@/components/cf/ModelPicker'
import { PROVIDER_KINDS, PROVIDER_LABELS, type ProviderKind } from '@/lib/ai/types'
import type { TestResult } from '@/lib/ai/providers'
import type { ProviderView } from '@/lib/providers-store'
import type { SettingValue } from '@/lib/settings'
import { useSetting } from '@/lib/use-setting'

const KEY_PLACEHOLDER: Record<ProviderKind, string> = { anthropic: 'sk-ant-…', openai: 'sk-…', google: 'AIza…', cloudflare: 'API token (Workers AI: Read)', ollama: '', custom: 'Optional' }
const TASKS = [['highlight', 'Highlight detection'], ['scoring', 'Scoring'], ['titles', 'Titles & descriptions'], ['vision', 'Vision (gaming events)']] as const

function ProviderCard({ view, onSaved }: { view: ProviderView; onSaved: (v: ProviderView) => void }) {
  const label = PROVIDER_LABELS[view.kind]
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(view.baseUrl ?? '')
  const [model, setModel] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const hasKey = view.kind !== 'ollama'
  const hasUrl = view.kind === 'ollama' || view.kind === 'custom' || view.kind === 'openai' || view.kind === 'cloudflare'
  const cf = view.kind === 'cloudflare' // its "base URL" is the account ID
  const dirty = key.trim() !== '' || (hasUrl && baseUrl !== (view.baseUrl ?? '')) // Test uses saved values

  const save = async (patch: { apiKey?: string; baseUrl?: string; enabled?: boolean }) => {
    const res = await fetch(`/api/providers/${view.kind}`, { method: 'PUT', body: JSON.stringify(patch) })
    if (!res.ok) return toast.error(`Couldn't save ${label}`)
    const nv: ProviderView = await res.json()
    onSaved(nv); setKey(''); setBaseUrl(nv.baseUrl ?? ''); toast.success(`${label} saved`)
  }
  const test = async () => {
    setTesting(true); setResult(null)
    try { setResult(await fetch(`/api/providers/${view.kind}/test`, { method: 'POST', body: JSON.stringify({ modelId: model ?? undefined }) }).then((r) => r.json())) }
    catch { setResult({ ok: false, error: { code: 'unknown', message: 'Request failed' } }) }
    finally { setTesting(false) }
  }

  return (
    <section data-testid={`provider-${view.kind}`} className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-cf">
      <div className="flex items-center gap-3">
        <h3 className="font-semibold">{label}</h3>
        {view.needsKey && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">No key</span>}
        <Switch className="ml-auto" aria-label={`Enable ${label}`} checked={view.enabled} onCheckedChange={(enabled) => save({ enabled })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {hasKey && (
          <Field label="API key">
            <Input type="password" autoComplete="off" aria-label="API key" value={key} onChange={(e) => setKey(e.target.value)}
              placeholder={view.keyHint ?? KEY_PLACEHOLDER[view.kind]} />
          </Field>
        )}
        {hasUrl && (
          <Field label={cf ? 'Account ID' : 'Base URL'}>
            <Input aria-label={cf ? 'Account ID' : 'Base URL'} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={cf ? 'From the Cloudflare dashboard → Workers AI' : 'https://…/v1'} />
          </Field>
        )}
      </div>
      <Field label="Test with model (optional)">
        <ModelPicker kind={view.kind} value={model} onChange={setModel} ariaLabel={`${label} model`} placeholder="Just list models" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => save({ apiKey: key, ...(hasUrl && { baseUrl }) })}>Save</Button>
        <Button size="sm" variant="secondary" onClick={test} disabled={testing || dirty}>{testing && <Loader2 className="animate-spin" />}Test connection</Button>
        {dirty && <span className="text-xs text-muted-foreground">Save first to test these values</span>}
        {!dirty && result && (result.ok
          ? <span className="flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 className="size-4" />Connected · {result.modelCount} models</span>
          : <span className="flex items-center gap-1.5 text-sm text-cf-accent"><XCircle className="size-4 shrink-0" />{result.error.message}</span>)}
      </div>
    </section>
  )
}

function UsageToday() {
  const [u, setU] = useState<{ date: string; counts: Record<string, number> } | null>(null)
  useEffect(() => { fetch('/api/settings/llmUsage').then((r) => r.json()).then(setU).catch(() => {}) }, [])
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const counts = u && u.date === today ? Object.entries(u.counts) : []
  return (
    <p data-testid="usage-today" className="text-xs text-muted-foreground">
      Requests today (resets at midnight Pacific, like free tiers): {counts.length ? counts.map(([k, n]) => `${k.split(':').slice(1).join(':')} ${n}`).join(' · ') : 'none yet'}
    </p>
  )
}

function TaskModels({ providers }: { providers: ProviderView[] }) {
  const { value, setValue, save, saving } = useSetting<SettingValue<'aiTasks'>>('aiTasks', 'Task models')
  if (!value) return <div className="h-48 animate-pulse rounded-xl bg-muted" />
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-cf">
      <div><h3 className="font-semibold">Model per task</h3><p className="text-sm text-muted-foreground">Optional. Use a strong model for highlights and a cheap one for titles.</p></div>
      {TASKS.map(([task, label]) => {
        const cur = value[task]
        const kind = cur?.provider ?? 'ollama'
        return (
          <div key={task} className="grid items-end gap-2 sm:grid-cols-[180px_1fr]">
            <Field label={label}>
              <Select value={kind} onValueChange={(p) => setValue({ ...value, [task]: cur ? { provider: p as ProviderKind, model: '' } : null })}>
                <SelectTrigger className="w-full" aria-label={`${label} provider`}><SelectValue /></SelectTrigger>
                <SelectContent>{PROVIDER_KINDS.map((k) => <SelectItem key={k} value={k} disabled={!providers.find((p) => p.kind === k)?.enabled}>{PROVIDER_LABELS[k]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <ModelPicker kind={kind} value={cur?.model || null} ariaLabel={`${label} model`} onChange={(model) => setValue({ ...value, [task]: { provider: kind, model } })} />
          </div>
        )
      })}
      <UsageToday />
      <Button className="self-start" size="sm" disabled={saving} onClick={() => save({ ...value, ...Object.fromEntries(TASKS.map(([t]) => [t, value[t]?.model ? value[t] : null])) })}>Save changes</Button>
    </section>
  )
}

export function AiSection() {
  const [providers, setProviders] = useState<ProviderView[] | null>(null)
  const [mem, setMem] = useState<number | null>(null)
  useEffect(() => {
    fetch('/api/providers').then((r) => r.json()).then(setProviders).catch(() => toast.error("Couldn't load providers"))
    fetch('/api/system').then((r) => r.json()).then((s) => setMem(s.totalMemBytes)).catch(() => {})
  }, [])
  if (!providers) return <div className="h-96 animate-pulse rounded-xl bg-muted" />
  return (
    <div className="flex flex-col gap-4">
      {mem !== null && mem <= 8 * 2 ** 30 && (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Cpu className="size-5 shrink-0 text-amber-600" />
          <p>This Mac has {Math.round(mem / 2 ** 30)} GB of memory. <strong>For a smooth Mac, use a cloud model</strong> — Gemini’s free tier works well (Flash for highlights, Flash-Lite for scoring and titles) and uses no memory here. Local models of 4B or larger fill most of the memory and the GPU, so the whole Mac lags while clips are found; a 2B model (e.g. <code>qwen3.5:2b</code>) is lighter but picks weaker clips.</p>
        </div>
      )}
      {providers.map((v) => <ProviderCard key={v.kind} view={v} onSaved={(nv) => setProviders(providers.map((p) => (p.kind === nv.kind ? nv : p)))} />)}
      <TaskModels providers={providers} />
    </div>
  )
}
