'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CfSlider } from '@/components/cf/CfSlider'
import { Field, Section } from '@/components/cf/Field'
import { Segmented } from '@/components/cf/Segmented'
import { blockedRects, clearSpot, FACE_LAYOUTS, HUD_PRESETS, regions, type Box, type GamingLayout } from '@/lib/gaming'
import { outputSize } from '@/lib/reframe'
import type { EditorState } from '@/lib/editor'
import { cn } from '@/lib/utils'
import type { PanelProps } from './types'

const r4 = (n: number) => Math.round(n * 10000) / 10000
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))

/** Subtitles moved to the spot nearest where they are now that's clear of the HUD zones and the facecam. */
export function placeSubtitles(s: EditorState, vw: number, vh: number): Partial<EditorState> {
  const { w: W, h: H } = outputSize(s.aspect, '1080p')
  const rs = regions(s.layoutId as GamingLayout, s, vw, vh, W, H)
  const blocked = blockedRects(rs, s.hud.zones, vw, vh)
  const now = Math.min(95, Math.max(5, { top: 15, middle: 50, bottom: 72 }[s.style.position] + s.style.offsetPct))
  const band = (s.style.sizePx * s.style.lines * 1.4 * 100) / H
  const y = clearSpot(blocked, W, H, band, Math.round(now))
  return y === Math.round(now) ? {} : { style: { ...s.style, position: 'middle', offsetPct: y - 50 } }
}

/** The whole video frame with the facecam box (coral) and HUD zones (amber) on it. Drag to draw a new box; drag inside the
 * facecam box to move it. */
function FramePicker({ state, set, videoRef, mode }: Pick<PanelProps, 'state' | 'set' | 'videoRef'> & { mode: 'facecam' | 'hud' }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ratio, setRatio] = useState(16 / 9)
  const [draft, setDraft] = useState<Box | null>(null)
  const start = useRef<{ x: number; y: number; move?: Box } | null>(null)
  useEffect(() => { // a live thumbnail of the frame under the playhead
    const id = setInterval(() => {
      const v = videoRef?.current, c = canvas.current
      if (!v?.videoWidth || !c) return
      setRatio(v.videoWidth / v.videoHeight)
      c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
    }, 250)
    return () => clearInterval(id)
  }, [videoRef])
  const at = (e: React.PointerEvent) => {
    const b = e.currentTarget.getBoundingClientRect()
    return { x: clamp((e.clientX - b.left) / b.width), y: clamp((e.clientY - b.top) / b.height) }
  }
  const f = state.facecam
  const down = (e: React.PointerEvent) => {
    const p = at(e)
    const inside = mode === 'facecam' && f && p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h
    start.current = { ...p, move: inside ? f : undefined }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const p = at(e)
    if (s.move) setDraft({ ...s.move, x: r4(clamp(s.move.x + p.x - s.x, 0, 1 - s.move.w)), y: r4(clamp(s.move.y + p.y - s.y, 0, 1 - s.move.h)) })
    else setDraft({ x: r4(Math.min(s.x, p.x)), y: r4(Math.min(s.y, p.y)), w: r4(Math.abs(p.x - s.x)), h: r4(Math.abs(p.y - s.y)) })
  }
  const up = () => {
    if (draft && draft.w >= 0.03 && draft.h >= 0.03) {
      if (mode === 'facecam') set({ facecam: draft })
      else set({ hud: { preset: null, zones: [...state.hud.zones, draft].slice(-20) } })
    }
    start.current = null
    setDraft(null)
  }
  const box = (b: Box, cls: string, key?: number) => (
    <div key={key} className={cn('pointer-events-none absolute', cls)} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />
  )
  const fc = mode === 'facecam' && draft ? draft : f
  return (
    <div data-testid={`picker-${mode}`} className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-lg bg-black" style={{ aspectRatio: ratio }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <canvas ref={canvas} width={320} height={Math.round(320 / ratio)} className="absolute inset-0 size-full" />
      {state.hud.zones.map((z, i) => box(z, 'bg-amber-300/25 outline-dashed outline-1 outline-amber-300', i))}
      {mode === 'hud' && draft && box(draft, 'bg-amber-300/40 outline outline-1 outline-amber-300')}
      {fc && box(fc, 'outline outline-2 outline-cf-accent bg-cf-accent/15')}
    </div>
  )
}

/** Facecam box, PiP bubble and HUD zones for the gaming layouts. */
export function GamingSections({ state, set, videoRef }: Pick<PanelProps, 'state' | 'set' | 'videoRef'>) {
  const dims = (): [number, number] => [videoRef?.current?.videoWidth || 1920, videoRef?.current?.videoHeight || 1080]
  const hud = (h: EditorState['hud']) => { const next = { ...state, hud: h }; set({ hud: h, ...placeSubtitles(next, ...dims()) }) }
  const needsFace = (FACE_LAYOUTS as readonly string[]).includes(state.layoutId)
  return (
    <>
      {needsFace && (
        <Section title="Facecam">
          <p className="text-xs text-muted-foreground">
            {state.facecam ? 'Drag the box to move it, or drag anywhere to draw a new one. It’s remembered for this channel.' : 'No webcam found — drag over it to draw the facecam box.'}
          </p>
          <FramePicker state={state} set={set} videoRef={videoRef} mode="facecam" />
        </Section>
      )}
      {state.layoutId === 'pip' && (
        <Section title="Bubble">
          <Field label="Shape">
            <Segmented aria-label="Bubble shape" size="sm" value={state.pip.shape} onChange={(shape) => set({ pip: { ...state.pip, shape } })}
              options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }]} />
          </Field>
          <CfSlider label="Size" min={15} max={60} unit="%" value={Math.round(state.pip.size * 100)} onChange={(n) => set({ pip: { ...state.pip, size: n / 100 } })} />
          <p className="text-xs text-muted-foreground">Drag the bubble in the preview to move it.</p>
        </Section>
      )}
      <Section title="Game HUD">
        <p className="text-xs text-muted-foreground">Subtitles move off the game’s minimap, killfeed and health bars. Pick your game, or drag on the frame to mark a zone.</p>
        <div className="flex flex-wrap gap-1.5">
          {HUD_PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant={state.hud.preset === p.id ? 'default' : 'secondary'} aria-pressed={state.hud.preset === p.id}
              onClick={() => hud(state.hud.preset === p.id ? { preset: null, zones: [] } : { preset: p.id, zones: p.zones })}>{p.label}</Button>
          ))}
        </div>
        <FramePicker state={state} set={(p) => (p.hud ? hud(p.hud) : set(p))} videoRef={videoRef} mode="hud" />
        {!!state.hud.zones.length && <Button size="sm" variant="ghost" onClick={() => set({ hud: { preset: null, zones: [] } })}>Clear zones ({state.hud.zones.length})</Button>}
      </Section>
    </>
  )
}
