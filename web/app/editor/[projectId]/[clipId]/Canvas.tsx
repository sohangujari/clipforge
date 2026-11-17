'use client'
import { useMemo, useRef, useState, type RefObject } from 'react'
import { AssOverlay } from '@/components/cf/AssOverlay'
import { ClipVideo, type RealLayout } from '@/components/cf/ClipVideo'
import { buildAss } from '@/lib/ass'
import { keptDuration, middleRanges, retimeWords, type Range } from '@/lib/cuts'
import type { People } from '@/lib/people'

const NO_ZOOM: Range[] = []
import { applyFocus, centerAt, cropRect, minusFocus, outputSize, type Keyframe } from '@/lib/reframe'
import { ASPECT_RATIO, chunkAt, withFocus, type EditorState, type SafeZone } from '@/lib/editor'
import { LAYOUTS, type ThumbRect } from '@/lib/layouts'
import { blockedRects, isGaming, regions, type GameOpts } from '@/lib/gaming'
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

export interface RealMedia { src: string; track: Keyframe[]; playing: boolean; onTime: (t: number) => void; videoRef: RefObject<HTMLVideoElement | null>; keep: Range[]; zooms: Range[]; people: People | null; wide: Range[]
  speakerColors: string[]; shotAt: (t: number) => [number, number]; onFocus: (shot: [number, number], x: number, y: number) => void
  /** gaming layouts: drag the gameplay to move its crop, or the PiP bubble to move it; showHud: outline the HUD zones */
  onGame: (patch: Partial<Pick<EditorState, 'game' | 'pip'>>) => void; showHud: boolean }

export const HOOK_S = 3 // the hook line shows over the first seconds (worker/clipforge_worker/stages/render.py)

/** The ASS for the editor state on the cut clip's clock: same input the export builds (worker render job). */
/** The speaker plan's rows for a split/grid clip (null for other layouts, or before speakers were found). */
export function rowsFor(state: EditorState, people: People | null) {
  return people && (state.layoutId === 'split' || state.layoutId === 'grid') ? { plan: people[state.layoutId], faceH: people.faceH } : null
}

export function assFor(state: EditorState, keep: Range[], people: People | null = null, speakerColors: string[] | null = null): string {
  const { start, end } = state.trim
  const b = state.brand
  const text = state.watermarkOn && !b.logoPath && b.text?.value
  const { w: width, h: height } = outputSize(state.aspect, '1080p') // libass scales this to the canvas (and to 720p on export)
  return buildAss({
    style: state.style, width, height, duration: keptDuration(keep),
    words: state.subtitlesOn ? retimeWords(state.words.filter((w) => w.s >= start - 0.05 && w.e <= end + 0.05), keep) : [],
    hook: state.hook.on && state.hook.text ? { text: state.hook.text, end: HOOK_S } : null,
    speakerColors: state.speakerColors ? speakerColors : null,
    middle: middleRanges((rowsFor(state, people)?.plan.ranges ?? []).filter(([a, b]) => b > start && a < end), keep, state.aspect !== '16:9'),
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
  const ass = useMemo(() => (real ? assFor(state, real.keep, real.people, real.speakerColors) : ''), [real, state])
  const speakerLayout = real?.people && ['active-speaker', 'split', 'grid'].includes(state.layoutId)
  const zoomable = state.layoutId === 'single' || state.layoutId === 'active-speaker'

  // Reframe by hand: drag the picture to move the crop for the camera shot under the playhead.
  const drag = useRef<{ x0: number; y0: number; cx: number; cy: number; sx: number; sy: number; lo: [number, number]; shot: [number, number] } | null>(null)
  const [live, setLive] = useState<{ shot: [number, number]; x: number; y: number } | null>(null)
  const focus = useMemo(() => (live ? withFocus(state.focus, live.shot, live.x, live.y) : state.focus), [live, state.focus])
  const baseTrack = speakerLayout ? real!.people!.track : real?.track
  const track = useMemo(() => (baseTrack && zoomable ? applyFocus(baseTrack, focus) : baseTrack), [baseTrack, zoomable, focus])
  const wide = useMemo(() => (real && zoomable ? minusFocus(real.wide, focus) : real?.wide), [real, zoomable, focus])
  const shotNow = real && zoomable ? real.shotAt(t) : null
  const framed = shotNow && state.focus.some(([a, b]) => a === shotNow[0] && b === shotNow[1])
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = real?.videoRef.current
    if (!real || !track || !v?.videoWidth || e.button !== 0) return
    const [cx, cy] = centerAt(track, v.currentTime)
    const [, , w, h] = cropRect(cx, cy, v.videoWidth, v.videoHeight, ASPECT_RATIO[state.aspect])
    const r = e.currentTarget.getBoundingClientRect()
    const lo: [number, number] = [w / v.videoWidth / 2, h / v.videoHeight / 2] // past this the crop is at the frame's edge
    drag.current = { x0: e.clientX, y0: e.clientY, cx, cy, sx: w / v.videoWidth / r.width, sy: h / v.videoHeight / r.height, lo, shot: real.shotAt(v.currentTime) }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || (Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3 && !live)) return
    const clamp = (n: number, lo: number) => Math.min(Math.max(n, lo), 1 - lo)
    setLive({ shot: d.shot, x: clamp(d.cx - (e.clientX - d.x0) * d.sx, d.lo[0]), y: clamp(d.cy - (e.clientY - d.y0) * d.sy, d.lo[1]) })
  }
  const up = () => {
    if (live) real?.onFocus(live.shot, live.x, live.y)
    drag.current = null
    setLive(null)
  }

  // Gaming layouts: drag the gameplay to move its crop for the whole clip; drag the PiP bubble to move it.
  const gaming = real && isGaming(state.layoutId)
  const gdrag = useRef<{ x0: number; y0: number; mode: 'game' | 'pip'; game: [number, number]; pip: GameOpts['pip']; kx: number; ky: number; fw: number; fh: number } | null>(null)
  const [gLive, setGLive] = useState<Partial<GameOpts> | null>(null)
  const opts: GameOpts | null = useMemo(() => (gaming ? { facecam: state.facecam, game: state.game, pip: state.pip, ...gLive } : null), [gaming, state.facecam, state.game, state.pip, gLive])
  const out = outputSize(state.aspect, '1080p')
  const vdims = () => { const v = real?.videoRef.current; return [v?.videoWidth || 1920, v?.videoHeight || 1080] as const }
  const gdown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!opts || e.button !== 0) return
    const [vw, vh] = vdims(), rs = regions(state.layoutId as never, opts, vw, vh, out.w, out.h)
    const b = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - b.left) / b.width) * out.w, py = ((e.clientY - b.top) / b.height) * out.h
    const hit = [...rs].reverse().find((r) => px >= r.dst[0] && px < r.dst[0] + r.dst[2] && py >= r.dst[1] && py < r.dst[1] + r.dst[3])
    if (!hit) return
    const mode = state.layoutId === 'pip' && hit.kind === 'face' ? 'pip' : hit.kind === 'game' ? 'game' : null
    if (!mode) return
    // screen px → fraction of the source (gameplay) or of the frame (bubble)
    gdrag.current = { x0: e.clientX, y0: e.clientY, mode, game: state.game, pip: state.pip, fw: b.width, fh: b.height,
      kx: hit.src[2] / (hit.dst[2] * b.width / out.w) / vw, ky: hit.src[3] / (hit.dst[3] * b.height / out.h) / vh }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const gmove = (e: React.PointerEvent) => {
    const d = gdrag.current
    if (!d) return
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0, c = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000
    if (d.mode === 'game') setGLive({ game: [c(d.game[0] - dx * d.kx), c(d.game[1] - dy * d.ky)] })
    else setGLive({ pip: { ...d.pip, x: c(d.pip.x + dx / d.fw), y: c(d.pip.y + dy / d.fh) } })
  }
  const gup = () => {
    if (gLive) real?.onGame(gLive)
    gdrag.current = null
    setGLive(null)
  }
  const hud = gaming && real.showHud && opts && state.hud.zones.length
    ? blockedRects(regions(state.layoutId as never, opts, ...vdims(), out.w, out.h).filter((r) => r.kind === 'game'), state.hud.zones, ...vdims()) : []
  return (
    <div data-testid={testIds ? 'canvas-frame' : undefined} className={cn('relative overflow-hidden rounded-xl bg-black shadow-cf [container-type:inline-size]', className)}
      style={{ aspectRatio: ASPECT_RATIO[state.aspect] }}>
      {real ? (
        <>
          <ClipVideo src={real.src} track={track!} aspect={state.aspect} layout={state.layoutId as RealLayout}
            keep={real.keep} zooms={zoomable ? real.zooms : NO_ZOOM} rows={rowsFor(state, real.people)} wide={wide} gaming={opts}
            t={t} playing={real.playing} onTime={real.onTime} videoRef={real.videoRef} />
          <AssOverlay ass={ass} videoRef={real.videoRef} keep={real.keep} />
          {testIds && zoomable && (
            <div data-testid="reframe-surface" title="Drag to reframe this camera shot" className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          )}
          {testIds && gaming && (
            <div data-testid="game-surface" title={state.layoutId === 'pip' ? 'Drag the gameplay to move it, or the bubble to move the bubble' : 'Drag to move the gameplay'}
              className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing" onPointerDown={gdown} onPointerMove={gmove} onPointerUp={gup} onPointerCancel={gup} />
          )}
          {hud.map((r, i) => (
            <div key={i} data-testid="hud-zone" className="pointer-events-none absolute outline-dashed outline-1 outline-amber-300 bg-amber-300/15"
              style={pct({ x: r[0] / out.w, y: r[1] / out.h, w: r[2] / out.w, h: r[3] / out.h })} />
          ))}
          {testIds && framed && <span data-testid="manual-framing" className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">Framed by hand</span>}
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
