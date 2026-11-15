import { z } from 'zod'

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const SubtitleStyleSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  font: z.string().min(1),
  sizePx: z.number().min(12).max(160),
  weight: z.number().int().min(100).max(900),
  case: z.enum(['none', 'upper', 'lower']),
  color, activeColor: color,
  stroke: z.object({ color, width: z.number().min(0).max(20) }),
  shadow: z.object({ color, blur: z.number().min(0).max(40), x: z.number(), y: z.number() }).nullable(),
  box: z.object({ color, opacity: z.number().min(0).max(100), radius: z.number().min(0).max(40), padding: z.number().min(0).max(40) }).nullable(),
  wordsPerLine: z.number().int().min(1).max(10),
  lines: z.union([z.literal(1), z.literal(2)]),
  animation: z.enum(['highlight', 'pop', 'fade', 'slide', 'typewriter', 'none']),
  position: z.enum(['top', 'middle', 'bottom']),
  offsetPct: z.number().min(-40).max(40),
  emoji: z.boolean(),
  emphasis: z.boolean(),
})
export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>

const base: Omit<SubtitleStyle, 'id' | 'name'> = {
  font: 'Montserrat', sizePx: 64, weight: 800, case: 'upper', color: '#FFFFFF', activeColor: '#FFE14D',
  stroke: { color: '#000000', width: 6 }, shadow: { color: '#000000', blur: 8, x: 0, y: 4 }, box: null,
  wordsPerLine: 3, lines: 1, animation: 'highlight', position: 'bottom', offsetPct: 0, emoji: false, emphasis: true,
}
const p = (id: string, name: string, o: Partial<SubtitleStyle>): SubtitleStyle => ({ ...base, id, name, ...o })

export const builtinPresets: SubtitleStyle[] = [
  p('bold-pop', 'Bold Pop', { animation: 'pop', activeColor: '#3DF56B', wordsPerLine: 2 }),
  p('big-yellow', 'Big Yellow', { font: 'Anton', sizePx: 80, weight: 400, color: '#FFE14D', activeColor: '#FFFFFF', stroke: { color: '#000000', width: 8 } }),
  p('minimal', 'Minimal', { font: 'Inter', sizePx: 44, weight: 600, case: 'none', stroke: { color: '#000000', width: 0 }, shadow: { color: '#000000', blur: 12, x: 0, y: 2 }, animation: 'fade', wordsPerLine: 5, emphasis: false }),
  p('karaoke', 'Karaoke', { font: 'Poppins', weight: 700, case: 'none', activeColor: '#F26B5B', wordsPerLine: 4, lines: 2 }),
  p('neon', 'Neon', { font: 'Poppins', color: '#E8FDFF', activeColor: '#00F0FF', stroke: { color: '#0A2A33', width: 2 }, shadow: { color: '#00F0FF', blur: 24, x: 0, y: 0 } }),
  p('boxed', 'Boxed', { font: 'Inter', sizePx: 48, weight: 700, case: 'none', stroke: { color: '#000000', width: 0 }, shadow: null, box: { color: '#000000', opacity: 70, radius: 12, padding: 14 }, wordsPerLine: 4 }),
  p('typewriter', 'Typewriter', { font: 'Courier Prime', sizePx: 46, weight: 700, case: 'none', stroke: { color: '#000000', width: 3 }, animation: 'typewriter', wordsPerLine: 5 }),
  p('outline-clean', 'Outline Clean', { font: 'Inter', sizePx: 56, weight: 900, color: '#FFFFFF', activeColor: '#FFFFFF', stroke: { color: '#111113', width: 10 }, shadow: null, animation: 'slide' }),
  p('retro', 'Retro', { font: 'Bebas Neue', sizePx: 76, weight: 400, color: '#FFD23F', activeColor: '#FF5E5B', stroke: { color: '#2B1B17', width: 5 }, shadow: { color: '#2B1B17', blur: 0, x: 5, y: 5 } }),
  p('subtle-fade', 'Subtle Fade', { font: 'Geist', sizePx: 42, weight: 500, case: 'none', stroke: { color: '#000000', width: 0 }, box: { color: '#111113', opacity: 40, radius: 8, padding: 8 }, shadow: null, animation: 'fade', wordsPerLine: 6, lines: 2, emphasis: false }),
]
