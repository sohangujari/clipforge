import 'server-only'
import { z } from 'zod'
import { getDb } from './db'
import { PROVIDER_KINDS } from './ai/types'
import { SubtitleStyleSchema } from './subtitle-presets'
import { CONTENT_TYPES, POSITIONS, TONES } from './constants'

const taskModel = z.object({ provider: z.enum(PROVIDER_KINDS), model: z.string().min(1) }).nullable()


export const schemas = {
  aiTasks: z.object({ highlight: taskModel, scoring: taskModel, titles: taskModel, vision: taskModel })
    .default({ highlight: null, scoring: null, titles: null, vision: null }),
  brandKit: z.object({
    logoPath: z.string().optional(),
    position: z.enum(POSITIONS).default('br'),
    opacity: z.number().min(0).max(100).default(80),
    sizePct: z.number().min(2).max(40).default(12),
    marginPct: z.number().min(0).max(15).default(4),
    text: z.object({
      value: z.string().max(60), font: z.string().default('Geist'), color: z.string().default('#FFFFFF'), opacity: z.number().min(0).max(100).default(70),
    }).optional(),
    introPath: z.string().optional(),
    outroPath: z.string().optional(),
  }).default({ position: 'br', opacity: 80, sizePct: 12, marginPct: 4 }),
  subtitlePresets: z.object({ custom: z.array(SubtitleStyleSchema).default([]), defaultId: z.string().default('bold-pop') })
    .default({ custom: [], defaultId: 'bold-pop' }),
  defaults: z.object({
    clipCount: z.union([z.literal('auto'), z.number().int().min(3).max(20)]).default('auto'),
    lengthRange: z.union([z.tuple([z.literal(15), z.literal(60)]), z.tuple([z.literal(30), z.literal(90)]), z.tuple([z.literal(60), z.literal(180)])]).default([30, 90]),
    language: z.string().default('auto'),
    tone: z.enum(TONES).default('neutral'),
    contentType: z.enum(CONTENT_TYPES).default('auto'),
    whisperModel: z.enum(['large-v3-turbo', 'medium', 'small']).default('large-v3-turbo'),
  }).default({ clipCount: 'auto', lengthRange: [30, 90], language: 'auto', tone: 'neutral', contentType: 'auto', whisperModel: 'large-v3-turbo' }),
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
