'use client'
import { useId, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> { value: T; label?: string; icon?: ReactNode; title?: string }

export function Segmented<T extends string>({ value, options, onChange, className, size = 'md', 'aria-label': ariaLabel }: {
  value: T; options: SegmentedOption<T>[]; onChange: (v: T) => void; className?: string; size?: 'sm' | 'md'; 'aria-label'?: string
}) {
  const id = useId()
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex rounded-[10px] bg-[var(--cf-border)]/60 p-0.5 gap-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} title={o.title ?? o.label}
            onClick={() => onChange(o.value)}
            className={cn('relative flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150 whitespace-nowrap',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {active && <motion.span layoutId={id} transition={{ duration: 0.18 }} className="absolute inset-0 rounded-lg bg-card shadow-cf" />}
            <span className="relative flex items-center gap-1.5">{o.icon}{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
