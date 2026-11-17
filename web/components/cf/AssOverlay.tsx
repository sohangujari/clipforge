'use client'
import { useEffect, useRef, type RefObject } from 'react'
import type JASSUB from 'jassub'
import { FALLBACK_FONT, FONT_FILES } from '@/lib/ass'
import { toOut, type Range } from '@/lib/cuts'

/**
 * Draws the clip's ASS with JASSUB (libass in WebAssembly) — the same library and font files FFmpeg uses for the export,
 * so what you see here is what gets burned in. Canvas mode: the canvas covers the crop frame, not the (scaled) video.
 */
export function AssOverlay({ ass, videoRef, keep }: { ass: string; videoRef: RefObject<HTMLVideoElement | null>; keep: Range[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inst = useRef<JASSUB | null>(null) // set only once JASSUB is ready
  const live = useRef({ ass, keep })
  useEffect(() => { live.current = { ass, keep } })

  const size = () => {
    const c = canvasRef.current!, dpr = Math.min(2, window.devicePixelRatio || 1)
    return { width: Math.round(c.clientWidth * dpr), height: Math.round(c.clientHeight * dpr) }
  }
  const render = () => {
    const j = inst.current, v = videoRef.current
    if (!j || !v || !canvasRef.current?.clientWidth) return
    j.manualRender({ expectedDisplayTime: performance.now(), ...size(), mediaTime: toOut(live.current.keep, v.currentTime) /* the ASS runs on the cut clip's clock */ }, true).catch(() => {})
  }

  useEffect(() => {
    let dead = false, vfc = 0, j: JASSUB | null = null
    const v = videoRef.current
    // Absolute URLs: the worker fetches fonts itself and doesn't resolve paths against this page.
    const fonts = FONT_FILES.map((u) => new URL(u, location.origin).href)
    const fallback = fonts.find((u) => u.includes('noto-sans-devanagari-400'))!
    // Pre-bundled into public/jassub (scripts/bundle-jassub.mjs): Turbopack's production build hangs bundling JASSUB itself.
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '/jassub/jassub.js' as string).then(async ({ default: J }: { default: typeof JASSUB }) => {
      if (dead || !canvasRef.current) return
      j = new J({ canvas: canvasRef.current, subContent: live.current.ass, fonts, availableFonts: { [FALLBACK_FONT.toLowerCase()]: fallback }, defaultFont: FALLBACK_FONT.toLowerCase() })
      await j.ready
      if (dead) return
      await j.resize(true, size().width, size().height)
      inst.current = j
      if (live.current.ass) await j.renderer.setTrack(live.current.ass) // the style may have changed while starting
      canvasRef.current!.dataset.ready = '1'
      render()
      const tick = () => { render(); vfc = v?.requestVideoFrameCallback(tick) ?? 0 }
      if (v) vfc = v.requestVideoFrameCallback(tick)
    }).catch(() => {})
    const onSeek = () => render()
    v?.addEventListener('seeked', onSeek)
    const ro = new ResizeObserver(() => { inst.current?.resize(true, size().width, size().height).then(render).catch(() => {}) })
    if (canvasRef.current) ro.observe(canvasRef.current)
    return () => {
      dead = true
      v?.removeEventListener('seeked', onSeek)
      if (vfc) v?.cancelVideoFrameCallback(vfc)
      ro.disconnect()
      j?.destroy().catch(() => {})
      inst.current = null
    }
  }, [videoRef]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const j = inst.current
    if (j) Promise.resolve(j.renderer.setTrack(ass)).then(render).catch(() => {})
  }, [ass]) // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} data-testid="ass-overlay" className="pointer-events-none absolute inset-0 size-full" />
}
