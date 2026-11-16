/** A clip's editor choices, saved per clip and read by the export (worker reads the same JSON). */
import { z } from 'zod'
import type { EditorState } from './editor'
import { BrandKitObject } from './brand-kit'
import { SubtitleStyleSchema } from './subtitle-presets'

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
})
export type ClipEdit = z.infer<typeof ClipEditSchema>

/** The part of the editor state that is saved with the clip and used by the export. */
export const toEdit = (s: EditorState, settingsBrand?: EditorState['brand']): ClipEdit => ({ aspect: s.aspect, layoutId: s.layoutId === 'wide-blur' ? 'wide-blur' : 'single',
  style: s.style, subtitlesOn: s.subtitlesOn, watermarkOn: s.watermarkOn, trim: s.trim, resolution: s.resolution,
  ...(JSON.stringify(s.brand) !== JSON.stringify(settingsBrand) && { brand: s.brand }) })
