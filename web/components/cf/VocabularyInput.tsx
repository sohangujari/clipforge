'use client'
import { useState } from 'react'
import { X } from 'lucide-react'

const MAX = 50, MAX_LEN = 40

/** Chips for names and brand words; Enter or comma adds, Backspace on empty removes the last. */
export function VocabularyInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const words = raw.split(',').map((w) => w.trim().slice(0, MAX_LEN)).filter(Boolean)
    const next = [...value]
    for (const w of words) if (!next.includes(w) && next.length < MAX) next.push(w)
    onChange(next)
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/50">
      {value.map((w) => (
        <span key={w} data-testid="vocab-chip" className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
          {w}
          <button type="button" aria-label={`Remove ${w}`} onClick={() => onChange(value.filter((x) => x !== w))} className="text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
        </span>
      ))}
      <input aria-label="Custom words" value={draft} placeholder={value.length ? '' : 'Names, brands… (Enter to add)'}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        onChange={(e) => {
          if (e.target.value.includes(',')) { add(e.target.value); setDraft('') } else setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) { add(draft); setDraft('') } }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => { if (draft.trim()) { add(draft); setDraft('') } }} />
    </div>
  )
}
