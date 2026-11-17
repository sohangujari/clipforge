/** media/<id>/people.json, written by the worker's speakers stage (worker/clipforge_worker/clips/people.py). The preview
 * draws the speaker layouts from it and the export renders from it, so both show the same crops. */
import type { Keyframe } from './reframe'

export type RowPlan = { ranges: [number, number, number][]; tracks: Record<string, Keyframe[][]>; active?: [number, number, number, number][] }
export interface People { track: Keyframe[]; faceH: number | null; multi: boolean; speakers: number[]; split: RowPlan; grid: RowPlan }

export const SPEAKER_LAYOUTS = ['active-speaker', 'split', 'grid'] as const

/** Active speaker is the default when two or more people talk and share the screen at some point. */
export const defaultLayout = (p: People | null) => (p && p.multi && p.speakers.length >= 2 ? 'active-speaker' : 'single')
