import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { dataDir } from './paths'
import { createProject, ProjectError, type ProjectSettings, type ProjectView } from './projects'

export const MAX_UPLOAD = 20e9
export const MAX_CHUNK = 16 * 1024 * 1024
const EXTS = ['.mp4', '.mov', '.mkv', '.webm']

interface Meta { name: string; size: number; received: number }

const dir = () => { const d = join(/*turbopackIgnore: true*/ dataDir(), 'uploads'); mkdirSync(d, { recursive: true }); return d }
const files = (id: string) => {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ProjectError(404, 'Upload not found')
  return { part: join(/*turbopackIgnore: true*/ dir(), `${id}.part`), meta: join(/*turbopackIgnore: true*/ dir(), `${id}.json`) }
}
function readMeta(id: string): Meta {
  const f = files(id)
  if (!existsSync(f.meta)) throw new ProjectError(404, 'Upload not found')
  return JSON.parse(readFileSync(f.meta, 'utf8'))
}
const writeMeta = (id: string, m: Meta) => writeFileSync(files(id).meta, JSON.stringify(m))

/** The id is derived from name+size+lastModified, so re-selecting the same file after a reload resumes it. */
export function initUpload(m: { name: string; size: number; lastModified: number }): { uploadId: string; offset: number } {
  const name = String(m.name ?? '').slice(0, 255)
  if (!EXTS.includes(extname(name).toLowerCase())) throw new ProjectError(400, 'Use an MP4, MOV, MKV or WebM file')
  if (!Number.isFinite(m.size) || m.size <= 0 || m.size > MAX_UPLOAD) throw new ProjectError(400, 'Files must be under 20 GB')
  const uploadId = createHash('sha256').update(`${name}:${m.size}:${m.lastModified}`).digest('hex').slice(0, 32)
  const f = files(uploadId)
  if (existsSync(f.meta)) return { uploadId, offset: readMeta(uploadId).received }
  writeFileSync(f.part, '')
  writeMeta(uploadId, { name, size: m.size, received: 0 })
  return { uploadId, offset: 0 }
}

export function uploadOffset(id: string): { offset: number; size: number } {
  const m = readMeta(id)
  return { offset: m.received, size: m.size }
}

/** Streams the chunk to disk without buffering it whole. Rolls back on overflow. */
export async function appendChunk(id: string, offset: number, body: ReadableStream<Uint8Array> | null): Promise<{ offset: number }> {
  const m = readMeta(id)
  if (offset !== m.received) throw Object.assign(new ProjectError(409, 'Offset mismatch'), { offset: m.received })
  if (!body) return { offset: m.received }
  const f = files(id)
  truncateSync(f.part, m.received) // drop bytes written by a request that died before recording its offset
  const fh = await open(f.part, 'a')
  let n = 0
  try {
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n += value.byteLength
      if (n > MAX_CHUNK || m.received + n > m.size) { await reader.cancel(); throw new ProjectError(413, 'Chunk too large') }
      await fh.write(value)
    }
  } catch (e) {
    await fh.close(); truncateSync(f.part, m.received)
    throw e
  }
  await fh.close()
  writeMeta(id, { ...m, received: m.received + n })
  return { offset: m.received + n }
}

export async function completeUpload(id: string, settings: ProjectSettings, contentType?: string): Promise<ProjectView> {
  const m = readMeta(id)
  if (m.received !== m.size) throw new ProjectError(409, 'Upload is not finished')
  const projectId = randomUUID()
  const ext = extname(m.name).toLowerCase()
  const rel = `media/${projectId}/source${ext}`
  mkdirSync(join(/*turbopackIgnore: true*/ dataDir(), 'media', projectId), { recursive: true })
  const f = files(id)
  renameSync(f.part, join(/*turbopackIgnore: true*/ dataDir(), rel))
  const view = await createProject({ sourceType: 'upload', id: projectId, sourceFile: rel, title: m.name.slice(0, -ext.length) || m.name, settings, contentType })
  rmSync(f.meta) // spent: re-selecting the same file starts a new upload
  return view
}
