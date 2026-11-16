/** Brand kit (logo/text watermark, intro/outro). No server-only import: the editor validates per-clip overrides with it too. */
import { z } from 'zod'
import { POSITIONS } from './constants'

export const BrandKitObject = z.object({
  logoPath: z.string().optional(),
  logoPngPath: z.string().optional(), // PNG rendered from an SVG logo, for the export (FFmpeg can't read SVG)
  position: z.enum(POSITIONS).default('br'),
  opacity: z.number().min(0).max(100).default(80),
  sizePct: z.number().min(2).max(40).default(12),
  marginPct: z.number().min(0).max(15).default(4),
  text: z.object({
    value: z.string().max(60), font: z.string().default('Geist'), color: z.string().default('#FFFFFF'), opacity: z.number().min(0).max(100).default(70),
  }).optional(),
  introPath: z.string().optional(),
  outroPath: z.string().optional(),
})
export const BrandKitSchema = BrandKitObject.default({ position: 'br', opacity: 80, sizePct: 12, marginPct: 4 })
