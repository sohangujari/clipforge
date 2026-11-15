'use client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/cf/Field'
import { useSetting } from '@/lib/use-setting'
import { SaveBar } from './SaveBar'

type P = { name: string; handle: string; dataDir?: string; diskUsageBytes?: number }
const fmt = (b = 0) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`)

export function ProfileSection() {
  const { value: p, setValue, save, saving } = useSetting<P>('profile', 'Profile')
  if (!p) return <div className="h-64 animate-pulse rounded-xl bg-muted" />
  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-4 rounded-xl bg-card p-5 shadow-cf sm:grid-cols-2">
        <Field label="Display name"><Input aria-label="Display name" maxLength={80} value={p.name} onChange={(e) => setValue({ ...p, name: e.target.value })} /></Field>
        <Field label="Handle (default text watermark)"><Input aria-label="Handle" maxLength={40} placeholder="@yourhandle" value={p.handle} onChange={(e) => setValue({ ...p, handle: e.target.value })} /></Field>
      </section>
      <section className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-cf">
        <Field label="Data folder"><code className="break-all rounded-lg bg-muted px-2 py-1.5 text-xs">{p.dataDir}</code></Field>
        <Field label="Disk usage" inline><span className="text-sm font-medium tabular-nums">{fmt(p.diskUsageBytes)}</span></Field>
        <Button variant="outline" size="sm" className="self-start" disabled title="Arrives in Phase 2">Clear cache</Button>
        <p className="text-xs text-muted-foreground">Everything stays on this computer. No account, no cloud.</p>
      </section>
      <SaveBar saving={saving} onSave={() => save({ name: p.name, handle: p.handle })} />
    </div>
  )
}
