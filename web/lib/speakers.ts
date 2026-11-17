/** Speaker names and colours, per video (Project.speakers). Index = the speaker number the worker gave each voice. */
import { z } from 'zod'

/** Default colour per speaker number; worker/clipforge_worker/stages/render.py has the same list for exports. */
export const SPEAKER_COLORS = ['#F26B5B', '#5B8DF2', '#3FA796', '#E2B33C']

export const SpeakersSchema = z.array(z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) })).max(12)
export type Speaker = z.infer<typeof SpeakersSchema>[number]

/** Names/colours for speakers 0…n-1: saved ones, else "Speaker N" in the default colour. */
export const speakerList = (saved: Speaker[] | null | undefined, n: number): Speaker[] =>
  Array.from({ length: n }, (_, i) => saved?.[i] ?? { name: `Speaker ${i + 1}`, color: SPEAKER_COLORS[i % SPEAKER_COLORS.length] })
