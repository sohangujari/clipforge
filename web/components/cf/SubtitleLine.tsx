// ponytail: CSS preview, swapped for JASSUB (libass) in Phase 4 for render parity
import type { CSSProperties } from 'react'
import type { Word } from '@/lib/mock'
import type { SubtitleStyle } from '@/lib/subtitle-presets'
import { cn } from '@/lib/utils'

/** Sizes in a style are px at 1080px output width; cqw scales them to the frame (frame sets container-type). */
const u = (px: number) => `calc(${px} / 1080 * 100cqw)`

const hexA = (hex: string, pct: number) => `${hex}${Math.round((pct / 100) * 255).toString(16).padStart(2, '0')}`

export function SubtitleLine({ style: s, words, active, className, testId }: {
  style: SubtitleStyle; words: Word[]; active: number; className?: string; testId?: string
}) {
  const text: CSSProperties = {
    fontFamily: `"${s.font}", var(--font-geist-sans), sans-serif`,
    fontSize: u(s.sizePx), fontWeight: s.weight, lineHeight: 1.15, color: s.color,
    textTransform: s.case === 'upper' ? 'uppercase' : s.case === 'lower' ? 'lowercase' : 'none',
    WebkitTextStroke: s.stroke.width ? `${u(s.stroke.width)} ${s.stroke.color}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: s.shadow ? `${u(s.shadow.x)} ${u(s.shadow.y)} ${u(s.shadow.blur)} ${s.shadow.color}` : undefined,
    ...(s.box && { background: hexA(s.box.color, s.box.opacity), borderRadius: u(s.box.radius), padding: `${u(s.box.padding / 2)} ${u(s.box.padding)}` }),
  }
  const shown = s.animation === 'typewriter' && active >= 0 ? words.slice(0, active + 1) : words
  return (
    <div data-testid={testId} key={words[0]?.s} className={cn('cf-sub max-w-[90%] text-center', `cf-anim-${s.animation}`, className)}
      style={{ ...text, display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.3em' }}>
      {shown.map((w, i) => {
        const on = i === active && s.animation !== 'none' && s.animation !== 'fade'
        return (
          <span key={i} className={cn('inline-block transition-transform duration-100', on && s.animation === 'pop' && 'scale-110')}
            style={{ color: on ? s.activeColor : undefined }}>
            {w.w}
          </span>
        )
      })}
    </div>
  )
}
