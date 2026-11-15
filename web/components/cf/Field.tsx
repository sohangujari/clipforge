import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Field({ label, children, className, inline }: { label: string; children: ReactNode; className?: string; inline?: boolean }) {
  return (
    <div className={cn(inline ? 'flex items-center justify-between gap-3' : 'flex flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        className="size-5 cursor-pointer rounded border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch-wrapper]:p-0" />
      <span className="font-mono text-xs uppercase">{value}</span>
    </label>
  )
}
