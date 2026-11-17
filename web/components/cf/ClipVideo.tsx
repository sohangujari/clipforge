'use client'
import { useEffect, useRef, type RefObject } from 'react'
import { ASPECT_RATIO, type Aspect } from '@/lib/editor'
import { centerAt, cropRect, rowScale, type Keyframe } from '@/lib/reframe'
import type { RowPlan } from '@/lib/people'
import { zoomAt, type Range } from '@/lib/cuts'

/** Where playback should be: t itself, the start of the next kept part (inside a cut), or the first part (past the end: loop). */
export function nextPlayable(keep: Range[], t: number): number {
  for (const [a, b] of keep) {
    if (t < a - 0.02) return a
    if (t < b) return t
  }
  return keep[0][0]
}

const NONE: Range[] = []

export type RealLayout = 'single' | 'wide-blur' | 'active-speaker' | 'split' | 'grid'
export type Rows = { plan: RowPlan; faceH: number | null }

/**
 * The proxy video inside the editor frame, cropped the way the export will crop it (same track, same maths).
 * The crop is applied straight to the element every frame (no React re-render); onTime reports ~15×/s for the timeline.
 */
export function ClipVideo({ src, track, aspect, layout, keep, zooms, rows, wide = NONE, t, playing, onTime, videoRef }: {
  src: string; track: Keyframe[]; aspect: Aspect; layout: RealLayout; keep: Range[]; zooms: Range[]; rows?: Rows | null
  /** shots with no face found: shown whole over a blurred fill, as the export does */
  wide?: Range[]
  t: number; playing: boolean; onTime: (t: number) => void; videoRef: RefObject<HTMLVideoElement | null>
}) {
  const blurRef = useRef<HTMLCanvasElement>(null)
  const rowsRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ track, aspect, layout, keep, zooms, rows, wide, onTime })
  useEffect(() => { live.current = { track, aspect, layout, keep, zooms, rows, wide, onTime } })

  /** Split/Grid while 2–3 people are on screen: each person's crop drawn into a row (a column at 16:9), as the export's
   * vstack does; the talker's row outlined in Grid. Returns false when the single crop should show instead. */
  const drawRows = (v: HTMLVideoElement): boolean => {
    const { rows: r, aspect: a } = live.current, c = rowsRef.current, t = v.currentTime
    const range = r?.plan.ranges.find(([s, e]) => t >= s && t < e)
    if (!r || !c || !range) return false
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr)
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
    const g = c.getContext('2d')!, k = range[2], vertical = a !== '16:9'
    const rw = vertical ? W : W / k, rh = vertical ? H / k : H, ra = ASPECT_RATIO[a] * (vertical ? k : 1 / k)
    const scale = rowScale(r.faceH, v.videoWidth, v.videoHeight, ra)
    r.plan.tracks[String(k)].forEach((kf, j) => {
      const [x, y, w, h] = cropRect(...centerAt(kf, t), v.videoWidth, v.videoHeight, ra, scale)
      g.drawImage(v, x, y, w, h, vertical ? 0 : j * rw, vertical ? j * rh : 0, rw, rh)
    })
    const act = r.plan.active?.find(([s, e, kk]) => t >= s && t < e && kk === k)
    if (act) {
      const lw = (W * Math.max(4, Math.floor(1080 / 135))) / 1080 // drawbox t= in the export, at this size
      g.strokeStyle = '#F26B5B'; g.lineWidth = lw
      g.strokeRect((vertical ? 0 : act[3] * rw) + lw / 2, (vertical ? act[3] * rh : 0) + lw / 2, rw - lw, rh - lw)
    }
    return true
  }

  const apply = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const { track: k, aspect: a, layout: l, zooms: zs } = live.current
    const rowsOn = (l === 'split' || l === 'grid') && drawRows(v)
    v.style.visibility = rowsOn ? 'hidden' : '' // still plays the sound and drives the clock
    if (rowsRef.current) rowsRef.current.style.display = rowsOn ? '' : 'none'
    if (rowsOn) return
    const whole = l === 'wide-blur' || live.current.wide.some(([s, e]) => v.currentTime >= s && v.currentTime < e)
    if (blurRef.current) blurRef.current.style.display = whole ? '' : 'none'
    if (!whole) {
      const [cx, cy] = centerAt(k, v.currentTime)
      const [x, y, w, h] = cropRect(cx, cy, v.videoWidth, v.videoHeight, ASPECT_RATIO[a])
      const z = zoomAt(zs, v.currentTime) // punch-in about the frame's centre, as FFmpeg's zoompan does
      Object.assign(v.style, { width: `${(v.videoWidth / w) * 100 * z}%`, height: `${(v.videoHeight / h) * 100 * z}%`,
        left: `${((-x / w) * z - (z - 1) / 2) * 100}%`, top: `${((-y / h) * z - (z - 1) / 2) * 100}%` })
    } else {
      Object.assign(v.style, { width: '100%', height: 'auto', left: '0', top: '50%', transform: 'translateY(-50%)' })
      const c = blurRef.current
      c?.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
    }
    if (!whole) v.style.transform = ''
  }

  // Play/pause, skip the cut parts, loop, and keep the crop moving while playing.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (!playing) { v.pause(); apply(); return }
    const ks = live.current.keep
    if (v.currentTime < ks[0][0] || v.currentTime >= ks[ks.length - 1][1]) v.currentTime = ks[0][0]
    v.play().catch(() => {})
    let raf = 0, last = 0
    const step = (now: number) => {
      const next = nextPlayable(live.current.keep, v.currentTime)
      if (next !== v.currentTime && !v.seeking) v.currentTime = next
      apply()
      if (now - last > 66) { last = now; live.current.onTime(v.currentTime) }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seeks from the timeline while paused.
  useEffect(() => {
    const v = videoRef.current
    if (v && !playing && Math.abs(v.currentTime - t) > 0.04) v.currentTime = t
  }, [t, playing, videoRef])

  useEffect(apply, [aspect, layout, track, zooms, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <canvas ref={blurRef} data-testid="clip-video-blur" width={48} height={86} aria-hidden style={{ display: layout === 'wide-blur' ? undefined : 'none' }}
        className="absolute inset-0 size-full scale-125 object-cover opacity-80 blur-xl" />
      {(layout === 'split' || layout === 'grid') && <canvas ref={rowsRef} data-testid="clip-video-rows" aria-hidden className="absolute inset-0 size-full" />}
      <video ref={videoRef} data-testid="clip-video" src={src} muted={false} playsInline preload="auto" className="absolute max-w-none"
        onLoadedMetadata={(e) => { e.currentTarget.currentTime = t; apply() }} onSeeked={apply} />
    </>
  )
}
