/** Crop maths for the live preview — mirrors worker/clipforge_worker/clips/reframe.py (same test numbers). */
import type { Aspect } from './editor'

export type Keyframe = [t: number, cx: number, cy: number]

export function centerAt(k: Keyframe[], t: number): [number, number] {
  if (t <= k[0][0]) return [k[0][1], k[0][2]]
  for (let i = 1; i < k.length; i++) {
    const [t0, x0, y0] = k[i - 1], [t1, x1, y1] = k[i]
    if (t <= t1) { const a = t1 > t0 ? (t - t0) / (t1 - t0) : 1; return [x0 + (x1 - x0) * a, y0 + (y1 - y0) * a] }
  }
  return [k[k.length - 1][1], k[k.length - 1][2]]
}

/** Largest outAspect rect inside the source, centred on (cx, cy), clamped; all values even. [x, y, w, h] */
/** scale < 1: a tighter crop (one person of several, in split/grid rows). */
export function cropRect(cx: number, cy: number, srcW: number, srcH: number, outAspect: number, scale = 1): [number, number, number, number] {
  const [fw, fh] = (srcW / srcH > outAspect ? [srcH * outAspect, srcH] : [srcW, srcW / outAspect]).map((n) => n * scale)
  const w = Math.floor(Math.trunc(fw) / 2) * 2, h = Math.floor(Math.trunc(fh) / 2) * 2
  const x = Math.floor(Math.min(Math.max(Math.floor(cx * srcW - w / 2 + 0.5), 0), srcW - w) / 2) * 2
  const y = Math.floor(Math.min(Math.max(Math.floor(cy * srcH - h / 2 + 0.5), 0), srcH - h) / 2) * 2
  return [x, y, w, h]
}

export function outputSize(aspect: Aspect, res: '1080p' | '720p'): { w: number; h: number } {
  const s = res === '1080p' ? 1080 : 720, l = res === '1080p' ? 1920 : 1280
  return aspect === '9:16' ? { w: s, h: l } : aspect === '1:1' ? { w: s, h: s } : { w: l, h: s }
}

export const FACE_TO_CROP = 3.2 // split/grid rows: a person's crop is this many face-heights tall (clips/reframe.py)

/** cropRect scale for one person's row, tight enough that the neighbour isn't in it. faceH: share of frame height. */
export function rowScale(faceH: number | null, srcW: number, srcH: number, aspect: number): number {
  if (!faceH) return 1
  const fullH = srcW / srcH > aspect ? srcH : srcW / aspect
  return Math.min(1, Math.round(((FACE_TO_CROP * faceH * srcH) / fullH) * 10000) / 10000)
}
