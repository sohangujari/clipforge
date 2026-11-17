import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDb } from './db'
import { derive, type ClipEdit } from './clip-edit'
import { readPeople, readSilences, readWords } from './clip-views'
import { defaultLayout } from './people'
import { getSetting } from './settings'
import { builtinPresets } from './subtitle-presets'
import { ProjectError } from './projects'

export const Resolution = z.object({ resolution: z.enum(['1080p', '720p']) })

type ClipRow = { projectId: string; startSec: number; endSec: number; titles: string; hook: string | null; keywords: string | null }

/** Editor defaults for a clip never opened in the editor: brand kit + default subtitle preset, 9:16 face crop, fillers and
 * pauses cut, auto-zoom and the AI hook line on — the same as the editor starts with (EditorShell). */
async function defaultEdit(clip: ClipRow, resolution: ClipEdit['resolution']): Promise<ClipEdit> {
  const [brand, presets] = await Promise.all([getSetting('brandKit'), getSetting('subtitlePresets')])
  const style = [...builtinPresets, ...presets.custom].find((p) => p.id === presets.defaultId) ?? builtinPresets[0]
  const trim = { start: clip.startSec, end: clip.endSec }
  const words = readWords(clip.projectId).filter((w) => w.s >= trim.start - 0.05 && w.e <= trim.end + 0.05)
  const on = { removeFillers: true, removePauses: true, autoZoom: true }
  return { aspect: '9:16', layoutId: defaultLayout(readPeople(clip.projectId)), style, subtitlesOn: true, watermarkOn: true, brand, trim, resolution, ...on, bumpers: true,
    hook: { on: true, text: clip.hook ?? JSON.parse(clip.titles)[0] ?? '' },
    ...derive({ trim, words, ...on }, { silences: readSilences(clip.projectId), keywords: clip.keywords ? JSON.parse(clip.keywords) : [] }) }
}

/** Queues a render job. Doesn't touch the project's status: you can keep editing while it renders. */
export async function exportClips(projectId: string, clipIds: string[] | 'all', resolution: ClipEdit['resolution']): Promise<{ jobId: string }> {
  const db = getDb()
  const clips = await db.clip.findMany({
    where: { projectId, status: { not: 'deleted' }, ...(clipIds === 'all' ? {} : { id: { in: clipIds } }) }, orderBy: { score: 'desc' } })
  if (!clips.length || (clipIds !== 'all' && clips.length !== clipIds.length)) throw new ProjectError(404, 'Clip not found')
  // Clips never opened in the editor render with today's defaults, sent with the job — not saved on the clip, so later
  // Settings changes (logo, default style) still apply to them.
  const edits: Record<string, ClipEdit> = {}
  for (const c of clips) if (!c.edit) edits[c.id] = await defaultEdit(c, resolution)
  const id = randomUUID()
  await db.job.create({ data: { id, projectId, type: 'render', payload: JSON.stringify({ clipIds: clips.map((c) => c.id), resolution, zip: clipIds === 'all', edits }) } })
  return { jobId: id }
}

export async function exportClip(clipId: string, resolution: ClipEdit['resolution']) {
  const c = await getDb().clip.findUnique({ where: { id: clipId } })
  if (!c || c.status === 'deleted') throw new ProjectError(404, 'Clip not found')
  return exportClips(c.projectId, [clipId], resolution)
}

export interface JobStatus { status: string; progress: number; message: string | null; error: string | null; files: string[] }

/** Progress of any job; for a finished export, its download links (named after the clip or project title). */
export async function jobStatus(id: string): Promise<JobStatus | null> {
  const db = getDb()
  const j = await db.job.findUnique({ where: { id }, include: { project: true } })
  if (!j) return null
  let files: string[] = []
  if (j.type === 'render' && j.status === 'done' && j.payload) {
    const p = JSON.parse(j.payload) as { clipIds: string[]; resolution: string; zip: boolean }
    const name = (s: string) => `?name=${encodeURIComponent(s)}`
    if (p.zip) files = [`/api/files/renders/${j.projectId}-clips.zip${name(j.project.title)}`]
    else {
      const clips = await db.clip.findMany({ where: { id: { in: p.clipIds } } })
      files = p.clipIds.map((cid) => `/api/files/renders/${cid}-${p.resolution}.mp4${name(JSON.parse(clips.find((c) => c.id === cid)?.titles ?? '["clip"]')[0])}`)
    }
  }
  return { status: j.status, progress: j.progress, message: j.message, error: j.error, files }
}
