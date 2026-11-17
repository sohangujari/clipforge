/** A clip's editor choices, saved per clip and read by the export (worker reads the same JSON). */
import { z } from 'zod'
import type { EditorState } from './editor'
import { BrandKitObject } from './brand-kit'
import { SubtitleStyleSchema } from './subtitle-presets'
import { keepRanges, zoomRanges, type Range as Span } from './cuts'

const Range = z.tuple([z.number(), z.number()])

export const ClipEditSchema = z.object({
  aspect: z.enum(['9:16', '1:1', '16:9']),
  layoutId: z.enum(['single', 'wide-blur']), // the rest need speaker/facecam detection (Phases 6–7)
  style: SubtitleStyleSchema,
  subtitlesOn: z.boolean(),
  watermarkOn: z.boolean(),
  brand: BrandKitObject.optional(), // only when changed for this clip; otherwise the current Settings brand kit applies
  trim: z.object({ start: z.number().min(0), end: z.number() }).refine((t) => t.end > t.start, 'trim end must be after start'),
  words: z.array(z.object({ w: z.string().max(100), s: z.number(), e: z.number() })).max(2000).optional(), // edited transcript (Phase 5)
  resolution: z.enum(['1080p', '720p']),
  // Phase 4b. Missing in edits saved before it: the export then renders the plain trim, as it did.
  removeFillers: z.boolean().default(true),
  removePauses: z.boolean().default(true),
  autoZoom: z.boolean().default(true),
  hook: z.object({ on: z.boolean(), text: z.string().max(120) }).optional(),
  bumpers: z.boolean().default(true), // the brand kit's intro/outro, when it has them
  keep: z.array(Range).max(2000).optional(),  // worked out from the switches above (lib/cuts.ts): what the export plays…
  zooms: z.array(Range).max(500).optional(),  // …and where it punches in
})
export type ClipEdit = z.infer<typeof ClipEditSchema>

/** What the clip's audio and AI give the cuts and zooms: pauses found in the audio, the AI's zoom words. */
export interface ClipMedia { silences: Span[]; keywords: string[] }

/** Cut list + zoom moments for the editor state: what the preview plays and the export renders. */
export function derive(s: Pick<EditorState, 'trim' | 'words' | 'removeFillers' | 'removePauses' | 'autoZoom'>, m: ClipMedia) {
  const keep = keepRanges(s.trim, s.words, m.silences, { fillers: s.removeFillers, pauses: s.removePauses })
  return { keep, zooms: s.autoZoom ? zoomRanges(s.words, keep, m.keywords) : [] }
}

/** The part of the editor state that is saved with the clip and used by the export. */
export const toEdit = (s: EditorState, settingsBrand: EditorState['brand'] | undefined, m: ClipMedia): ClipEdit => ({
  aspect: s.aspect, layoutId: s.layoutId === 'wide-blur' ? 'wide-blur' : 'single',
  style: s.style, subtitlesOn: s.subtitlesOn, watermarkOn: s.watermarkOn, trim: s.trim, resolution: s.resolution,
  removeFillers: s.removeFillers, removePauses: s.removePauses, autoZoom: s.autoZoom, hook: s.hook, bumpers: s.bumpers, ...derive(s, m),
  ...(JSON.stringify(s.brand) !== JSON.stringify(settingsBrand) && { brand: s.brand }) })
