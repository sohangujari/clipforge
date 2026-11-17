'use client'
import { useMemo, type RefObject } from 'react'
import { AssOverlay } from '@/components/cf/AssOverlay'
import { ClipVideo, type RealLayout } from '@/components/cf/ClipVideo'
import { buildAss } from '@/lib/ass'
import { keptDuration, retimeWords, type Range } from '@/lib/cuts'
import { outputSize, type Keyframe } from '@/lib/reframe'
import { ASPECT_RATIO, chunkAt, type EditorState, type SafeZone } from '@/lib/editor'
import { LAYOUTS, type ThumbRect } from '@/lib/layouts'
import { positionStyle } from '@/components/cf/PositionGrid'
import { SubtitleLine } from '@/components/cf/SubtitleLine'
import { cn } from '@/lib/utils'

const SAFE: Record<Exclude<SafeZone, 'off'>, ThumbRect[]> = {
  tiktok: [{ x: 0.84, y: 0.42, w: 0.16, h: 0.4, kind: 'blur' }, { x: 0, y: 0.8, w: 1, h: 0.2, kind: 'blur' }],
  reels: [{ x: 0.85, y: 0.5, w: 0.15, h: 0.35, kind: 'blur' }, { x: 0, y: 0.82, w: 1, h: 0.18, kind: 'blur' }],
  shorts: [{ x: 0.84, y: 0.45, w: 0.16, h: 0.4, kind: 'blur' }, { x: 0, y: 0.85, w: 1, h: 0.15, kind: 'blur' }],
}
const SUB_TOP = { top: 15, middle: 50, bottom: 72 }
const pct = (r: { x: number; y: number; w: number; h: number }) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` })

function Region({ r, thumbnail }: { r: ThumbRect; thumbnail: string }) {
  if (r.kind === 'caption') return null
  const bg = r.kind === 'face' ? thumbnail : r.kind === 'game' ? 'linear-gradient(160deg,#16423c,#3fa796 60%,#c4e86b)' : r.kind === 'screen' ? 'linear-gradient(180deg,#e9edf5,#c9d3e6)' : thumbnail
  return (
    <div className={cn('absolute overflow-hidden', r.kind === 'blur' && 'blur-md scale-110 opacity-70')} style={{ ...pct(r), background: bg }}>
      {r.kind === 'face' && (
        <div className="absolute inset-0 flex flex-col items-center justify-end">
          <div className="mb-[-2%] aspect-square w-[34%] rounded-full bg-white/80" style={{ maxHeight: '38%' }} />
          <div className="h-[34%] w-[62%] rounded-t-[40%] bg-white/70" />
        </div>
      )}
      {r.kind === 'screen' && <div className="absolute inset-[8%] space-y-[6%]">{[70, 90, 55, 80].map((w, i) => <div key={i} className="h-[5%] rounded bg-slate-400/60" style={{ width: `${w}%` }} />)}</div>}
    </div>
  )
}

export interface RealMedia { src: string; track: Keyframe[]; playing: boolean; onTime: (t: number) => void; videoRef: RefObject<HTMLVideoElement | null>; keep: Range[]; zooms: Range[] }

export const HOOK_S = 3 // the hook line shows over the first seconds (worker/clipforge_worker/stages/render.py)

/** The ASS for the editor state on the cut clip's clock: same input the export builds (worker render job). */
export function assFor(state: EditorState, keep: Range[]): string {
  const { start, end } = state.trim
  const b = state.brand
  const text = state.watermarkOn && !b.logoPath && b.text?.value
  const { w: width, h: height } = outputSize(state.aspect, '1080p') // libass scales this to the canvas (and to 720p on export)
  return buildAss({
    style: state.style, width, height, duration: keptDuration(keep),
    words: state.subtitlesOn ? retimeWords(state.words.filter((w) => w.s >= start - 0.05 && w.e <= end + 0.05), keep) : [],
    hook: state.hook.on && state.hook.text ? { text: state.hook.text, end: HOOK_S } : null,
    watermarkText: text ? { value: b.text!.value, font: b.text!.font, color: b.text!.color, opacity: (b.opacity * b.text!.opacity) / 100, position: b.position, marginPct: b.marginPct, sizePct: b.sizePct } : null,
  })
}

export function CanvasFrame({ state, t, thumbnail, className, testIds = true, real }: {
  state: EditorState; t: number; thumbnail: string; className?: string; testIds?: boolean; real?: RealMedia
}) {
  const layout = LAYOUTS.find((l) => l.id === state.layoutId) ?? LAYOUTS[0]
  const chunk = chunkAt(state.words, state.style.wordsPerLine * state.style.lines, t)
  const b = state.brand
  const logoSrc = b.logoPath ? `/api/files/${b.logoPath}` : null
  const ass = useMemo(() => (real ? assFor(state, real.keep) : ''), [real, state])
  return (
    <div data-testid={testIds ? 'canvas-frame' : undefined} className={cn('relative overflow-hidden rounded-xl bg-black shadow-cf [container-type:inline-size]', className)}
      style={{ aspectRatio: ASPECT_RATIO[state.aspect] }}>
      {real ? (
        <>
          <ClipVideo src={real.src} track={real.track} aspect={state.aspect} layout={state.layoutId as RealLayout} keep={real.keep} zooms={real.zooms}
            t={t} playing={real.playing} onTime={real.onTime} videoRef={real.videoRef} />
          <AssOverlay ass={ass} videoRef={real.videoRef} keep={real.keep} />
        </>
      ) : layout.thumb.map((r, i) => <Region key={i} r={r} thumbnail={thumbnail} />)}
      {!real && state.subtitlesOn && chunk.words.length > 0 && (
        <div className="absolute inset-x-0 flex justify-center" style={{ top: `${SUB_TOP[state.style.position] + state.style.offsetPct}%`, transform: 'translateY(-50%)' }}>
          <SubtitleLine testId={testIds ? 'canvas-subtitle' : undefined} style={state.style} words={chunk.words} active={chunk.active} />
        </div>
      )}
      {state.watermarkOn && (
        <div data-testid={testIds ? 'canvas-watermark' : undefined} className="absolute" style={{ ...positionStyle(b.position, b.marginPct), opacity: b.opacity / 100 }}>
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="" style={{ width: `${b.sizePct}cqw` }} />
          ) : real ? null : b.text?.value ? (
            <span style={{ color: b.text.color, opacity: b.text.opacity / 100, fontSize: `${Math.max(2.5, b.sizePct / 3)}cqw` }} className="font-semibold [text-shadow:0_1px_4px_rgb(0_0_0/0.6)]">{b.text.value}</span>
          ) : (
            <span style={{ width: `${b.sizePct}cqw`, fontSize: `${b.sizePct / 4}cqw` }} className="flex aspect-[2/1] items-center justify-center rounded-[1cqw] border border-white/60 font-bold tracking-wider text-white/90">LOGO</span>
          )}
        </div>
      )}
      {state.safeZone !== 'off' && SAFE[state.safeZone].map((r, i) => (
        <div key={i} className="absolute bg-[repeating-linear-gradient(45deg,rgb(242_107_91/0.35)_0_6px,transparent_6px_12px)] outline outline-1 outline-cf-accent/70" style={pct(r)} />
      ))}
    </div>
  )
}
