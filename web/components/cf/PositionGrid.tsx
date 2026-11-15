'use client'
import { POSITIONS } from '@/lib/constants'
import { cn } from '@/lib/utils'

export type Position = (typeof POSITIONS)[number]
const NAMES: Record<Position, string> = {
  tl: 'Top left', tc: 'Top center', tr: 'Top right', ml: 'Middle left', c: 'Center', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom center', br: 'Bottom right',
}

export function PositionGrid({ value, onChange }: { value: Position; onChange: (p: Position) => void }) {
  return (
    <div role="radiogroup" aria-label="Watermark position" className="grid w-28 grid-cols-3 gap-1 rounded-[10px] bg-[var(--cf-border)]/60 p-1">
      {POSITIONS.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={value === p} aria-label={NAMES[p]} title={NAMES[p]} onClick={() => onChange(p)}
          className={cn('flex aspect-square items-center justify-center rounded-md transition-colors duration-150', value === p ? 'bg-card shadow-cf' : 'hover:bg-card/50')}>
          <span className={cn('size-1.5 rounded-full', value === p ? 'bg-cf-accent' : 'bg-muted-foreground/40')} />
        </button>
      ))}
    </div>
  )
}

/** CSS placement for a 9-grid position with a margin in % of frame width. */
export function positionStyle(p: Position, marginPct: number): React.CSSProperties {
  const m = `${marginPct}cqw`
  const v = p[0] === 't' ? { top: m } : p[0] === 'b' ? { bottom: m } : { top: '50%' }
  const col = p.length === 1 ? 'c' : p[1]
  const h = col === 'l' ? { left: m } : col === 'r' ? { right: m } : { left: '50%' }
  const tx = col === 'c' ? '-50%' : '0', ty = p[0] === 'm' || p === 'c' ? '-50%' : '0'
  return { ...v, ...h, transform: `translate(${tx}, ${ty})` }
}
