import 'server-only'
import { z } from 'zod'
import { getDb } from './db'
import { PROVIDER_KINDS } from './ai/types'
import { SubtitleStyleSchema } from './subtitle-presets'
import { BrandKitSchema } from './brand-kit'
import { CONTENT_TYPES, TONES } from './constants'

/** Names and brand words fed to Whisper's prompt. Trimmed, empties dropped, ≤ 50 × 40 chars. */
export const VocabularySchema = z.array(z.string()).transform((a) => a.map((w) => w.trim()).filter(Boolean)).pipe(z.array(z.string().max(40)).max(50))
export const CAPTION_SCRIPTS = ['native', 'hinglish'] as const

const taskModel = z.object({ provider: z.enum(PROVIDER_KINDS), model: z.string().min(1) }).nullable()


export const schemas = {
  aiTasks: z.object({ highlight: taskModel, scoring: taskModel, titles: taskModel, vision: taskModel })
    .default({ highlight: null, scoring: null, titles: null, vision: null }),
  brandKit: BrandKitSchema,
  subtitlePresets: z.object({ custom: z.array(SubtitleStyleSchema).default([]), defaultId: z.string().default('bold-pop') })
    .default({ custom: [], defaultId: 'bold-pop' }),
  defaults: z.object({
    clipCount: z.union([z.literal('auto'), z.number().int().min(3).max(20)]).default('auto'),
    lengthRange: z.union([z.tuple([z.literal(15), z.literal(60)]), z.tuple([z.literal(30), z.literal(90)]), z.tuple([z.literal(60), z.literal(180)])]).default([30, 90]),
    language: z.string().default('auto'),
    tone: z.enum(TONES).default('neutral'),
    contentType: z.enum(CONTENT_TYPES).default('auto'),
    whisperModel: z.enum(['large-v3-turbo', 'medium', 'small']).default('large-v3-turbo'),
    vocabulary: VocabularySchema.default([]),
    captionScript: z.enum(CAPTION_SCRIPTS).default('native'),
  }).default({ clipCount: 'auto', lengthRange: [30, 90], language: 'auto', tone: 'neutral', contentType: 'auto', whisperModel: 'large-v3-turbo', vocabulary: [], captionScript: 'native' }),
  /** Requests per provider:model for the current Pacific-time day (free tiers reset at midnight Pacific). */
  llmUsage: z.object({ date: z.string().default(''), counts: z.record(z.string(), z.number()).default({}) }).default({ date: '', counts: {} }),
  profile: z.object({ name: z.string().max(80).default(''), handle: z.string().max(40).default('') }).default({ name: '', handle: '' }),
}

export type SettingKey = keyof typeof schemas
export type SettingValue<K extends SettingKey> = z.output<(typeof schemas)[K]>
export const isSettingKey = (k: string): k is SettingKey => k in schemas

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await getDb().setting.findUnique({ where: { key } })
  const parsed = schemas[key].safeParse(row ? JSON.parse(row.value) : undefined)
  // A stored value that no longer validates (schema changed) falls back to defaults rather than breaking the page.
  return (parsed.success ? parsed.data : schemas[key].parse(undefined)) as SettingValue<K>
}

/** Throws ZodError on invalid input. */
export async function setSetting<K extends SettingKey>(key: K, value: unknown): Promise<SettingValue<K>> {
  const v = schemas[key].parse(value) as SettingValue<K>
  const json = JSON.stringify(v)
  await getDb().setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
  return v
}
