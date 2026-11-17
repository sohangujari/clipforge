'use client'
import { useEffect, useRef, type RefObject } from 'react'
import { ASPECT_RATIO, type Aspect } from '@/lib/editor'
import { centerAt, cropRect, type Keyframe } from '@/lib/reframe'
import { zoomAt, type Range } from '@/lib/cuts'

/** Where playback should be: t itself, the start of the next kept part (inside a cut), or the first part (past the end: loop). */
export function nextPlayable(keep: Range[], t: number): number {
  for (const [a, b] of keep) {
    if (t < a - 0.02) return a
    if (t < b) return t
  }
  return keep[0][0]
}

export type RealLayout = 'single' | 'wide-blur'

/**
 * The proxy video inside the editor frame, cropped the way the export will crop it (same track, same maths).
 * The crop is applied straight to the element every frame (no React re-render); onTime reports ~15×/s for the timeline.
 */
export function ClipVideo({ src, track, aspect, layout, keep, zooms, t, playing, onTime, videoRef }: {
  src: string; track: Keyframe[]; aspect: Aspect; layout: RealLayout; keep: Range[]; zooms: Range[]
  t: number; playing: boolean; onTime: (t: number) => void; videoRef: RefObject<HTMLVideoElement | null>
}) {
  const blurRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ track, aspect, layout, keep, zooms, onTime })
  useEffect(() => { live.current = { track, aspect, layout, keep, zooms, onTime } })

  const apply = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const { track: k, aspect: a, layout: l, zooms: zs } = live.current
    if (l === 'single') {
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
    if (l === 'single') v.style.transform = ''
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

  useEffect(apply, [aspect, layout, track, zooms]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {layout === 'wide-blur' && (
        <canvas ref={blurRef} data-testid="clip-video-blur" width={48} height={86} aria-hidden
          className="absolute inset-0 size-full scale-125 object-cover opacity-80 blur-xl" />
      )}
      <video ref={videoRef} data-testid="clip-video" src={src} muted={false} playsInline preload="auto" className="absolute max-w-none"
        onLoadedMetadata={(e) => { e.currentTarget.currentTime = t; apply() }} onSeeked={apply} />
    </>
  )
}
