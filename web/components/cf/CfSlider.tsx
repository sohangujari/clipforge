'use client'
import { cn } from '@/lib/utils'

export function CfSlider({ value, min, max, step = 1, unit = '', label, onChange, className, format }: {
  value: number; min: number; max: number; step?: number; unit?: string; label?: string
  onChange: (v: number) => void; className?: string; format?: (v: number) => string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      <span className="flex items-center gap-3">
        <input type="range" className="cf-range flex-1" min={min} max={max} step={step} value={value} aria-label={label}
          style={{ ['--pct' as string]: `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="w-12 text-right text-xs font-medium tabular-nums">{format ? format(value) : `${value}${unit}`}</span>
      </span>
    </label>
  )
}
