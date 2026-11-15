import type { LayoutOption, ThumbRect } from '@/lib/layouts'

const FILL: Record<ThumbRect['kind'], string> = {
  face: 'var(--cf-thumb-face, #8b8b96)', game: '#3fa796', screen: '#6b8cce', blur: '#c9c9cf', caption: '#ffffff',
}

/** 9:16 SVG sketch of a layout. */
export function LayoutThumb({ layout, className }: { layout: LayoutOption; className?: string }) {
  return (
    <svg viewBox="0 0 90 160" className={className} aria-hidden>
      <rect width="90" height="160" rx="6" fill="#26262b" />
      {layout.thumb.map((r, i) => {
        const [x, y, w, h] = [r.x * 90, r.y * 160, r.w * 90, r.h * 160]
        if (r.kind === 'caption') return <rect key={i} x={x} y={y} width={w} height={Math.max(h, 5)} rx="2" fill={FILL.caption} />
        return (
          <g key={i}>
            <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} rx="4" fill={FILL[r.kind]} opacity={r.kind === 'blur' ? 0.35 : 0.9} />
            {r.kind === 'face' && <><circle cx={x + w / 2} cy={y + h * 0.42} r={Math.min(w, h) * 0.16} fill="#e9e9ee" /><rect x={x + w / 2 - Math.min(w, h) * 0.26} y={y + h * 0.6} width={Math.min(w, h) * 0.52} height={h * 0.3} rx={Math.min(w, h) * 0.2} fill="#e9e9ee" /></>}
          </g>
        )
      })}
    </svg>
  )
}
