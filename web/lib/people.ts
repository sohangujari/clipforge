/** media/<id>/people.json, written by the worker's speakers stage (worker/clipforge_worker/clips/people.py). The preview
 * draws the speaker layouts from it and the export renders from it, so both show the same crops. */
import type { Keyframe } from './reframe'

export type RowPlan = { ranges: [number, number, number][]; tracks: Record<string, Keyframe[][]>; active?: [number, number, number, number][] }
export interface People { track: Keyframe[]; faceH: number | null; multi: boolean; speakers: number[]; split: RowPlan; grid: RowPlan }

export const SPEAKER_LAYOUTS = ['active-speaker', 'split', 'grid'] as const

/** The layout a clip starts with. Streams: facecam on top when a webcam overlay was found, else the gameplay alone;
 * reactions: the reactor under the content. Otherwise active speaker when two or more people talk and share the screen. */
export function defaultLayout(p: People | null, contentType = 'auto', facecam: unknown = null) {
  if (contentType === 'gaming') return facecam ? 'facecam-top' : 'gameplay-only'
  if (contentType === 'reaction' && facecam) return 'reaction-stack'
  return p && p.multi && p.speakers.length >= 2 ? 'active-speaker' : 'single'
}
