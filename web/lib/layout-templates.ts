/** Saved layouts ("Podcast 2-cam", "My GTA stream layout"): framing, subtitle spot and watermark spot — and for streams the
 * facecam box, PiP bubble and HUD zones — reusable on any clip. */
import { z } from 'zod'
import { POSITIONS } from './constants'
import type { EditorState } from './editor'
import { BoxSchema, HudSchema, PipSchema, RENDERABLE } from './clip-edit'

export const LayoutTemplate = z.object({
  id: z.string().max(40), name: z.string().trim().min(1).max(60),
  layoutId: z.enum(RENDERABLE), aspect: z.enum(['9:16', '1:1', '16:9']),
  subtitles: z.object({ position: z.enum(['top', 'middle', 'bottom']), offsetPct: z.number().min(-40).max(40) }),
  watermark: z.enum(POSITIONS),
  facecam: BoxSchema.nullable().optional(), pip: PipSchema.optional(), hud: HudSchema.optional(),
})
export type LayoutTemplate = z.infer<typeof LayoutTemplate>
export const LayoutTemplates = z.array(LayoutTemplate).max(50).default([])

export const templateFrom = (s: EditorState, name: string, id: string): LayoutTemplate => ({
  id, name, layoutId: s.layoutId as LayoutTemplate['layoutId'], aspect: s.aspect,
  subtitles: { position: s.style.position, offsetPct: s.style.offsetPct }, watermark: s.brand.position,
  ...(s.facecam && { facecam: s.facecam }), pip: s.pip, hud: s.hud })

/** The editor-state patch that applies a template to a clip. */
export const applyTemplate = (s: EditorState, t: LayoutTemplate): Partial<EditorState> => ({
  layoutId: t.layoutId, aspect: t.aspect, style: { ...s.style, position: t.subtitles.position, offsetPct: t.subtitles.offsetPct },
  brand: { ...s.brand, position: t.watermark },
  ...(t.facecam && { facecam: t.facecam }), ...(t.pip && { pip: t.pip }), ...(t.hud && { hud: t.hud }) })
