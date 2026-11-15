'use client'
import { useState } from 'react'
import { Check, ChevronsUpDown, Loader2, Plus, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ModelInfo, ProviderKind } from '@/lib/ai/types'
import { cn } from '@/lib/utils'

const fmtGB = (b?: number) => (b ? `${(b / 1e9).toFixed(1)} GB` : '')

/** Fetches the provider's models on open; lets the user add any model ID. */
export function ModelPicker({ kind, value, onChange, ariaLabel, placeholder = 'Choose a model' }: {
  kind: ProviderKind; value: string | null; onChange: (id: string) => void; ariaLabel: string; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = async () => {
    setModels(null); setError(null)
    try {
      const r = await fetch(`/api/providers/${kind}/models`).then((x) => x.json())
      if (r.error) setError(typeof r.error === 'string' ? r.error : r.error.message)
      else setModels(r.models)
    } catch { setError('Could not load models') }
  }
  const pick = (id: string) => { onChange(id); setOpen(false); setQuery('') }
  const q = query.trim()

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load() }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label={ariaLabel} className="w-full justify-between font-normal">
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or type a model ID" value={query} onValueChange={setQuery} />
          <CommandList>
            {!models && !error && <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading models…</div>}
            {error && <div className="p-3 text-sm text-cf-accent">{error}</div>}
            {models && <CommandEmpty>No matching models.</CommandEmpty>}
            {models && models.length > 0 && (
              <CommandGroup>
                {models.map((m) => (
                  <CommandItem key={m.id} value={m.id} keywords={[m.label]} onSelect={() => pick(m.id)}>
                    <Check className={cn('size-4', value === m.id ? 'opacity-100' : 'opacity-0')} />
                    <span className="flex-1 truncate">{m.label}</span>
                    {m.ramWarning && <span title="Larger than 4 GB — may be slow on an 8 GB Mac" className="flex items-center gap-1 text-xs text-amber-600"><TriangleAlert className="size-3" />May be slow on 8GB</span>}
                    {m.sizeBytes && !m.ramWarning && <span className="text-xs text-muted-foreground">{fmtGB(m.sizeBytes)}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {q && !models?.some((m) => m.id === q) && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`__custom__${q}`} onSelect={() => pick(q)}><Plus className="size-4" />Add custom model ID “{q}”</CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
