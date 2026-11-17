import 'server-only'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from './db'
import { dataDir } from './paths'
import type { ClipEdit } from './clip-edit'
import type { Range } from './cuts'
import type { MockClip, Word } from './mock'

/** A real clip in the same shape as the Phase 1 MockClip, so ClipCard/ClipDetails/editor accept both. */
export interface ClipView extends MockClip {
  status: 'new' | 'kept' | 'deleted'; source: 'auto' | 'search'; query?: string; thumbnailUrl?: string
  signals: Record<string, number>; signalsUsed: string[]; reasons: Record<string, string>; edit?: ClipEdit
  hook?: string; keywords: string[]
}

type Row = Awaited<ReturnType<ReturnType<typeof getDb>['clip']['findFirstOrThrow']>>

export function readWords(projectId: string): Word[] {
  try {
    return JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ dataDir(), 'media', projectId, 'transcript.json'), 'utf8')).words
  } catch { return [] }
}

/** Pauses found in the audio (worker/clipforge_worker/pauses.py); none before Phase 4b or "Find clips again". */
export function readSilences(projectId: string): Range[] {
  try {
    return JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ dataDir(), 'media', projectId, 'silences.json'), 'utf8')).silences
  } catch { return [] }
}

export function toClipView(r: Row, words: Word[]): ClipView {
  const b = JSON.parse(r.breakdown)
  const thumb = join(/*turbopackIgnore: true*/ dataDir(), 'media', r.projectId, 'clips', `${r.id}.jpg`)
  return {
    id: r.id, projectId: r.projectId, startSec: r.startSec, endSec: r.endSec, score: Math.round(r.score),
    breakdown: { hook: b.hook, emotion: b.emotion, value: b.value, pacing: b.pacing, trend: b.trend, extra: b.extra },
    reasons: b.reasons ?? {}, signalsUsed: b.signals_used ?? [],
    reason: r.reason, tips: JSON.parse(r.tips), titles: JSON.parse(r.titles), descriptions: JSON.parse(r.descriptions),
    hashtags: JSON.parse(r.hashtags), signals: JSON.parse(r.signals),
    transcript: words.filter((w) => w.s >= r.startSec - 0.05 && w.e <= r.endSec + 0.05),
    status: r.status as ClipView['status'], source: r.source as ClipView['source'], query: r.query ?? undefined,
    thumbnailUrl: existsSync(thumb) ? `/api/files/media/${r.projectId}/clips/${r.id}.jpg` : undefined,
    edit: r.edit ? JSON.parse(r.edit) : undefined,
    hook: r.hook ?? undefined, keywords: r.keywords ? JSON.parse(r.keywords) : [],
  }
}

export async function listClips(projectId: string): Promise<ClipView[]> {
  const rows = await getDb().clip.findMany({ where: { projectId, status: { not: 'deleted' } }, orderBy: { score: 'desc' } })
  const words = readWords(projectId)
  return rows.map((r) => toClipView(r, words))
}

export async function getClip(id: string): Promise<ClipView | null> {
  const r = await getDb().clip.findUnique({ where: { id } })
  return r ? toClipView(r, readWords(r.projectId)) : null
}

export async function setClipEdit(id: string, edit: ClipEdit): Promise<ClipView | null> {
  const r = await getDb().clip.updateMany({ where: { id }, data: { edit: JSON.stringify(edit) } })
  return r.count ? getClip(id) : null
}

export const tasteCount = () => getDb().clipFeedback.count()

/** Keep/delete a clip and record it as a taste example for future runs. */
export async function setClipStatus(id: string, status: 'kept' | 'deleted'): Promise<ClipView | null> {
  const db = getDb()
  const r = await db.clip.findUnique({ where: { id }, include: { project: true } })
  if (!r) return null
  await db.clip.update({ where: { id }, data: { status } })
  const text = toClipView(r, readWords(r.projectId)).transcript.slice(0, 40).map((w) => w.w).join(' ')
  await db.clipFeedback.create({ data: { id: randomUUID(), contentType: r.project.contentType, action: status, summary: `“${JSON.parse(r.titles)[0]}” — ${text}` } })
  return getClip(id)
}
