/** Gaming / stream layouts (Phase 7): where the facecam and the gameplay go in the output frame. The preview draws these
 * rects on a canvas and the export overlays the same crops — worker/clipforge_worker/clips/gaming.py is a line-by-line
 * port, kept identical by shared/cuts-fixture.json. */
import { cropRect } from './reframe'

/** A box in the source frame, as fractions of its width and height. */
export type Box = { x: number; y: number; w: number; h: number }
export type PipShape = 'circle' | 'rounded'
export interface Pip { x: number; y: number; size: number; shape: PipShape }
export interface GameOpts { facecam: Box | null; game: [number, number]; pip: Pip }
/** src and dst are [x, y, w, h] in pixels (even): src in the source video, dst in the output frame. */
export interface Region { kind: 'face' | 'game'; src: number[]; dst: number[]; shape: 'rect' | PipShape }

export const GAMING_LAYOUTS = ['facecam-top', 'facecam-bottom', 'pip', 'gameplay-only', 'reaction-stack'] as const
export type GamingLayout = (typeof GAMING_LAYOUTS)[number]
export const isGaming = (l: string): l is GamingLayout => (GAMING_LAYOUTS as readonly string[]).includes(l)
/** Layouts that show the facecam: they need a facecam box. */
export const FACE_LAYOUTS = ['facecam-top', 'facecam-bottom', 'pip', 'reaction-stack'] as const
export const DEFAULT_PIP: Pip = { x: 0.76, y: 0.15, size: 0.36, shape: 'circle' }
const FACE_SHARE = { 'facecam-top': 0.35, 'facecam-bottom': 0.35, 'reaction-stack': 0.5 } as const
export const ROUND_R = 0.18 // rounded bubble: corner radius as a share of its shorter side

const half = (n: number) => Math.floor(n + 0.5) // same half-up rounding as Python
const even = (n: number) => Math.floor(half(n) / 2) * 2

/** The largest `aspect` rect inside the box, centred on it (the facecam, filling its slot). */
export function cover(b: Box, srcW: number, srcH: number, aspect: number): number[] {
  const bw = b.w * srcW, bh = b.h * srcH
  const [fw, fh] = bw / bh > aspect ? [bh * aspect, bh] : [bw, bw / aspect]
  const w = Math.max(2, Math.floor(Math.trunc(fw) / 2) * 2), h = Math.max(2, Math.floor(Math.trunc(fh) / 2) * 2)
  const x = Math.floor(Math.min(Math.max(half(b.x * srcW + (bw - w) / 2), 0), srcW - w) / 2) * 2
  const y = Math.floor(Math.min(Math.max(half(b.y * srcH + (bh - h) / 2), 0), srcH - h) / 2) * 2
  return [x, y, w, h]
}

/** The regions of a gaming layout, drawn in order (the PiP bubble last, on top). No facecam box: gameplay only. */
export function regions(layout: GamingLayout, o: GameOpts, srcW: number, srcH: number, W: number, H: number): Region[] {
  const game = (dst: number[]): Region => ({ kind: 'game', src: cropRect(o.game[0], o.game[1], srcW, srcH, dst[2] / dst[3]), dst, shape: 'rect' })
  const face = (dst: number[], shape: Region['shape'] = 'rect'): Region => ({ kind: 'face', src: cover(o.facecam!, srcW, srcH, dst[2] / dst[3]), dst, shape })
  if (layout === 'gameplay-only' || !o.facecam) return [game([0, 0, W, H])]
  if (layout === 'pip') {
    const bw = even(W * o.pip.size), bh = o.pip.shape === 'circle' ? bw : even(bw * 0.75)
    const bx = even(Math.min(Math.max(o.pip.x * W - bw / 2, 0), W - bw)), by = even(Math.min(Math.max(o.pip.y * H - bh / 2, 0), H - bh))
    return [game([0, 0, W, H]), face([bx, by, bw, bh], o.pip.shape)]
  }
  const fh = even(H * FACE_SHARE[layout])
  if (layout === 'facecam-top') return [face([0, 0, W, fh]), game([0, fh, W, H - fh])]
  return [game([0, 0, W, H - fh]), face([0, H - fh, W, fh])] // facecam-bottom, reaction-stack: content on top
}

/** Where the facecam and the gameplay meet, as % of the output height (the default subtitle spot), or null. */
export function seam(layout: string, hasFacecam: boolean): number | null {
  if (!hasFacecam) return null
  return layout === 'facecam-top' ? 35 : layout === 'facecam-bottom' ? 65 : layout === 'reaction-stack' ? 50 : null
}

/** The subtitle style moved onto the seam (position middle + offset), for layouts that have one. */
export function atSeam<S extends { position: 'top' | 'middle' | 'bottom'; offsetPct: number }>(style: S, layout: string, hasFacecam: boolean): S {
  const y = seam(layout, hasFacecam)
  return y === null ? style : { ...style, position: 'middle', offsetPct: y - 50 }
}

// ---- Facecam auto-detect: a small face that stays in one place for much of the video (a webcam overlay over moving
// gameplay). Uses the faces the worker already found (media/<id>/faces.json "all": [cx, cy, w, h] per face per frame).

const CELL = 0.05          // centres binned on a 20×20 grid
const MIN_SHARE = 0.25     // in at least a quarter of the sampled frames…
const MAX_FACE_W = 0.16    // …and small: a talking head filling the frame isn't a facecam
const BOX_FACES = 3.4      // a webcam overlay is ~3–4 face widths wide

export function detectFacecam(all: number[][][] | undefined, srcW: number, srcH: number): Box | null {
  if (!all?.length) return null
  const bins = new Map<string, number[][]>()
  all.forEach((faces) => {
    const seen = new Set<string>()
    for (const f of faces) {
      const k = `${Math.floor(f[0] / CELL)},${Math.floor(f[1] / CELL)}`
      if (seen.has(k)) continue
      seen.add(k); (bins.get(k) ?? bins.set(k, []).get(k)!).push(f)
    }
  })
  let best: number[][] = []
  for (const [k, fs] of bins) { // a face hovering on a cell border lands in two: count the 3×3 neighbourhood
    const [i, j] = k.split(',').map(Number)
    const near = [-1, 0, 1].flatMap((di) => [-1, 0, 1].flatMap((dj) => bins.get(`${i + di},${j + dj}`) ?? []))
    if (fs.length && near.length > best.length) best = near
  }
  if (best.length < MIN_SHARE * all.length) return null
  const med = (i: number) => [...best].map((f) => f[i]).sort((a, b) => a - b)[best.length >> 1]
  const [cx, cy, fw, fh] = [0, 1, 2, 3].map(med)
  if (fw > MAX_FACE_W) return null
  const w = Math.min(1, fw * BOX_FACES), h = Math.min(1, Math.max(fh * 2.4, (w * srcW * 9) / 16 / srcH)) // a 16:9 webcam
  const r4 = (n: number) => Math.round(n * 10000) / 10000
  const snap = (a: number, size: number) => { // overlays usually sit against an edge: snap when within 4%
    const p = Math.min(Math.max(a - size / 2, 0), 1 - size)
    return p < 0.04 ? 0 : p > 1 - size - 0.04 ? 1 - size : p
  }
  return { x: r4(snap(cx, w)), y: r4(snap(cy, h)), w: r4(w), h: r4(h) }
}

// ---- HUD safe zones: where common games draw their HUD, as fractions of the gameplay frame. Subtitles are moved off them.

export interface HudPreset { id: string; label: string; zones: Box[] }
export const HUD_PRESETS: HudPreset[] = [
  { id: 'gta', label: 'GTA', zones: [{ x: 0.01, y: 0.72, w: 0.2, h: 0.26 }, { x: 0.78, y: 0.02, w: 0.21, h: 0.12 }] },
  { id: 'cod', label: 'Call of Duty', zones: [{ x: 0.01, y: 0.02, w: 0.18, h: 0.3 }, { x: 0.01, y: 0.62, w: 0.3, h: 0.22 }, { x: 0.78, y: 0.82, w: 0.21, h: 0.16 }] },
  { id: 'forza', label: 'Forza', zones: [{ x: 0.76, y: 0.68, w: 0.23, h: 0.3 }, { x: 0.01, y: 0.02, w: 0.2, h: 0.14 }] },
  { id: 'fortnite', label: 'Fortnite', zones: [{ x: 0.82, y: 0.02, w: 0.17, h: 0.3 }, { x: 0.01, y: 0.82, w: 0.3, h: 0.16 }, { x: 0.62, y: 0.86, w: 0.37, h: 0.13 }] },
  { id: 'valorant', label: 'Valorant', zones: [{ x: 0.01, y: 0.02, w: 0.2, h: 0.3 }, { x: 0.3, y: 0.0, w: 0.4, h: 0.09 }, { x: 0.3, y: 0.86, w: 0.4, h: 0.13 }] },
  { id: 'minecraft', label: 'Minecraft', zones: [{ x: 0.3, y: 0.84, w: 0.4, h: 0.15 }] },
]

const overlaps = (a: number[], b: number[]) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

/** HUD zones and the facecam, mapped into the output frame through each gameplay region (pixels, [x, y, w, h]). */
export function blockedRects(rs: Region[], zones: Box[], srcW: number, srcH: number): number[][] {
  const out: number[][] = []
  for (const r of rs) {
    if (r.kind === 'face') { out.push(r.dst); continue }
    const [sx, sy, sw, sh] = r.src, [dx, dy, dw, dh] = r.dst
    for (const z of zones) {
      const x0 = Math.max(0, (z.x * srcW - sx) / sw), y0 = Math.max(0, (z.y * srcH - sy) / sh)
      const x1 = Math.min(1, ((z.x + z.w) * srcW - sx) / sw), y1 = Math.min(1, ((z.y + z.h) * srcH - sy) / sh)
      if (x1 > x0 && y1 > y0) out.push([dx + x0 * dw, dy + y0 * dh, (x1 - x0) * dw, (y1 - y0) * dh])
    }
  }
  return out
}

/** The subtitle centre (% of height) nearest `want` whose band is clear of every blocked rect; `want` itself if none is. */
export function clearSpot(blocked: number[][], W: number, H: number, bandPct: number, want: number): number {
  const free = (y: number) => !blocked.some((b) => overlaps([W * 0.1, ((y - bandPct / 2) * H) / 100, W * 0.8, (bandPct * H) / 100], b))
  for (let d = 0; d <= 80; d += 1) for (const y of [want - d, want + d]) if (y >= 10 && y <= 90 && free(y)) return y
  return want
}
