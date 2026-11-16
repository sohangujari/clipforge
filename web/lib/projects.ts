import 'server-only'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { getDb } from './db'
import { dataDir } from './paths'
import { CONTENT_TYPES, TONES } from './constants'
import { CAPTION_SCRIPTS, VocabularySchema } from './settings'

export const ProjectSettingsSchema = z.object({
  clipCount: z.union([z.literal('auto'), z.number().int().min(3).max(20)]).default('auto'),
  lengthRange: z.union([z.tuple([z.literal(15), z.literal(60)]), z.tuple([z.literal(30), z.literal(90)]), z.tuple([z.literal(60), z.literal(180)])]).default([30, 90]),
  language: z.string().max(10).default('auto'),
  tone: z.enum(TONES).default('neutral'),
  vocabulary: VocabularySchema.default([]),
  captionScript: z.enum(CAPTION_SCRIPTS).default('native'),
  whisperModel: z.enum(['large-v3-turbo', 'medium', 'small']).default('large-v3-turbo'),
})
export type ProjectSettings = z.output<typeof ProjectSettingsSchema>
export const ContentTypeSchema = z.enum(CONTENT_TYPES).default('auto')

export class ProjectError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface ProjectView {
  id: string; title: string; sourceType: string; status: string; stage?: string; progress: number
  message?: string; error?: string; warning?: string; durationSec?: number; language?: string
  contentType: string; thumbnailUrl?: string; createdAt: string; hasTranscript: boolean; captionScript: string; clipCount: number; jobType: string
}

const mediaDir = (id: string) => join(/*turbopackIgnore: true*/ dataDir(), 'media', id)

/** The project's own pipeline jobs. Exports (render jobs) run alongside and never drive the project's status, progress, cancel or retry. */
const NOT_RENDER = { type: { not: 'render' } }

type Row = Awaited<ReturnType<typeof loadRow>>
async function loadRow(id: string) {
  return getDb().project.findUnique({ where: { id }, include: { jobs: { where: NOT_RENDER, orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { clips: { where: { status: { not: 'deleted' } } } } } } })
}

function toView(p: NonNullable<Row>): ProjectView {
  const job = p.jobs[0]
  const dir = mediaDir(p.id)
  return {
    id: p.id, title: p.title, sourceType: p.sourceType, status: p.status,
    stage: job?.stage ?? undefined, progress: job?.progress ?? 0, message: job?.message ?? undefined, error: job?.error ?? undefined,
    warning: p.warning ?? undefined, durationSec: p.durationSec ?? undefined, language: p.language ?? undefined, contentType: p.contentType,
    thumbnailUrl: existsSync(join(/*turbopackIgnore: true*/ dir, 'thumb.jpg')) ? `/api/files/media/${p.id}/thumb.jpg` : undefined,
    createdAt: p.createdAt.toISOString(), hasTranscript: existsSync(join(/*turbopackIgnore: true*/ dir, 'transcript.json')),
    captionScript: (JSON.parse(p.settings) as ProjectSettings).captionScript ?? 'native',
    clipCount: p._count.clips,
    jobType: job?.type ?? 'ingest',
  }
}

export type CreateInput =
  | { sourceType: 'url'; url: string; settings: ProjectSettings; contentType?: string }
  | { sourceType: 'upload'; id?: string; sourceFile: string; title: string; settings: ProjectSettings; contentType?: string }

export function parseHttpUrl(raw: unknown): URL {
  try {
    const u = new URL(String(raw).trim())
    if (u.protocol === 'http:' || u.protocol === 'https:') return u
  } catch { /* fallthrough */ }
  throw new ProjectError(400, 'Paste a full link starting with https://')
}

export async function createProject(input: CreateInput): Promise<ProjectView> {
  const id = (input.sourceType === 'upload' && input.id) || randomUUID()
  const contentType = ContentTypeSchema.parse(input.contentType ?? 'auto')
  const base = { id, contentType, settings: JSON.stringify(input.settings), jobs: { create: { id: randomUUID() } } }
  const data = input.sourceType === 'url'
    ? (() => { const u = parseHttpUrl(input.url); return { ...base, sourceType: 'url', sourceUrl: u.toString(), title: (u.host + u.pathname).replace(/\/$/, '').slice(0, 200) } })()
    : { ...base, sourceType: 'upload', sourceFile: input.sourceFile, title: input.title.slice(0, 200) }
  await getDb().project.create({ data })
  return (await getProject(id))!
}

export async function listProjects(): Promise<ProjectView[]> {
  const rows = await getDb().project.findMany({ orderBy: { createdAt: 'desc' }, include: { jobs: { where: NOT_RENDER, orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { clips: { where: { status: { not: 'deleted' } } } } } } })
  return rows.map(toView)
}

export async function getProject(id: string): Promise<ProjectView | null> {
  const row = await loadRow(id)
  return row ? toView(row) : null
}

async function mustLoad(id: string) {
  const row = await loadRow(id)
  if (!row) throw new ProjectError(404, 'Project not found')
  return row
}

export async function cancelProject(id: string): Promise<ProjectView> {
  const row = await mustLoad(id)
  const job = row.jobs[0]
  const db = getDb()
  if (!job) throw new ProjectError(409, 'Nothing to cancel')
  // Conditional updates: the worker may claim the job between our read and write.
  const queued = await db.job.updateMany({ where: { id: job.id, status: 'queued' }, data: { status: 'cancelled' } })
  if (queued.count) {
    await db.project.update({ where: { id }, data: { status: 'cancelled' } })
  } else {
    const running = await db.job.updateMany({ where: { id: job.id, status: 'running' }, data: { status: 'cancel_requested' } })
    if (!running.count) throw new ProjectError(409, 'Nothing to cancel')
  }
  return (await getProject(id))!
}

export async function retryProject(id: string): Promise<ProjectView> {
  const row = await mustLoad(id)
  if (row.status !== 'failed' && row.status !== 'cancelled') throw new ProjectError(409, 'Only failed or cancelled projects can be retried')
  const db = getDb()
  await db.job.create({ data: { id: randomUUID(), projectId: id, stageDone: row.jobs[0]?.stageDone ?? '[]' } })
  await db.project.update({ where: { id }, data: { status: 'queued', warning: null } })
  return (await getProject(id))!
}

export async function deleteProject(id: string): Promise<void> {
  const row = await mustLoad(id)
  if (row.jobs.some((j) => j.status === 'running' || j.status === 'cancel_requested')) throw new ProjectError(409, 'Cancel processing before deleting')
  await getDb().project.delete({ where: { id } })
  rmSync(mediaDir(id), { recursive: true, force: true })
}

async function startJob(id: string, type: 'analyze' | 'search', payload?: object): Promise<ProjectView> {
  const row = await mustLoad(id)
  const db = getDb()
  const busy = await db.job.count({ where: { projectId: id, ...NOT_RENDER, status: { in: ['queued', 'running', 'cancel_requested'] } } })
  if (busy) throw new ProjectError(409, 'This video is still processing — try again when it finishes')
  if (!existsSync(join(/*turbopackIgnore: true*/ mediaDir(id), 'transcript.json'))) throw new ProjectError(409, 'This video has no transcript yet')
  await db.job.create({ data: { id: randomUUID(), projectId: id, type, payload: payload ? JSON.stringify(payload) : null } })
  await db.project.update({ where: { id: row.id }, data: { status: 'queued', warning: null } })
  return (await getProject(id))!
}

/** "Find clips" / "Find clips again": re-run clip finding on the existing transcript. */
export const analyzeProject = (id: string) => startJob(id, 'analyze')

/** Plain-language moment search, e.g. "where they talk about pricing". */
export function searchProject(id: string, query: string): Promise<ProjectView> {
  const q = query.trim()
  if (q.length < 3 || q.length > 200) return Promise.reject(new ProjectError(400, 'Describe the moment in 3–200 characters'))
  return startJob(id, 'search', { query: q })
}

export const isTerminal = (projectStatus: string) => ['ready', 'failed', 'cancelled'].includes(projectStatus)

/** Route helper: ProjectError → JSON response with its status. */
export async function handle<T>(fn: () => Promise<T>, okStatus = 200): Promise<Response> {
  try {
    const v = await fn()
    return v === undefined ? new Response(null, { status: 204 }) : Response.json(v, { status: okStatus })
  } catch (e) {
    if (e instanceof ProjectError) return Response.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) return Response.json({ error: 'Invalid settings', issues: e.issues }, { status: 400 })
    throw e
  }
}
