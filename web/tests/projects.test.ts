import { beforeEach, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshDb } from './helpers'

let dir: string
beforeEach(() => { dir = freshDb(); vi.resetModules() })

const settings = { clipCount: 'auto', lengthRange: [30, 90], language: 'auto', tone: 'neutral', vocabulary: [], captionScript: 'native' }
const ctx = <T extends Record<string, unknown>>(p: T) => ({ params: Promise.resolve(p) })
const post = (body: unknown) => new Request('http://x/api/projects', { method: 'POST', body: JSON.stringify(body) })

async function create(url = 'https://www.youtube.com/watch?v=EZrPQUlQWz4', s: object = settings) {
  const { POST } = await import('@/app/api/projects/route')
  return POST(post({ url, settings: s }))
}
const db = async () => (await import('@/lib/db')).getDb()

test('create from url', async () => {
  const res = await create()
  expect(res.status).toBe(201)
  const p = await res.json()
  expect(p.status).toBe('queued')
  expect(p.title).toContain('youtube.com')
  const jobs = await (await db()).job.findMany({ where: { projectId: p.id } })
  expect(jobs).toHaveLength(1)
  expect(jobs[0].status).toBe('queued')
})

test('rejects non-http url', async () => {
  for (const url of ['ftp://x', 'not a url', 'javascript:alert(1)']) {
    const res = await create(url)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Paste a full link starting with https://')
  }
})

test('vocabulary cleaned and capped', async () => {
  const p = await (await create(undefined, { ...settings, vocabulary: ['  Sohan ', '', 'ClipForge'] })).json()
  const row = await (await db()).project.findUnique({ where: { id: p.id } })
  expect(JSON.parse(row!.settings).vocabulary).toEqual(['Sohan', 'ClipForge'])
  const tooMany = await create(undefined, { ...settings, vocabulary: Array.from({ length: 51 }, (_, i) => `w${i}`) })
  expect(tooMany.status).toBe(400)
})

test('cancel queued vs running', async () => {
  const { POST: cancel } = await import('@/app/api/projects/[id]/cancel/route')
  const a = await (await create()).json()
  const ra = await (await cancel(new Request('http://x'), ctx({ id: a.id }))).json()
  expect(ra.status).toBe('cancelled')
  const b = await (await create()).json()
  await (await db()).job.updateMany({ where: { projectId: b.id }, data: { status: 'running' } })
  await cancel(new Request('http://x'), ctx({ id: b.id }))
  const job = await (await db()).job.findFirst({ where: { projectId: b.id } })
  expect(job!.status).toBe('cancel_requested')
})

test('retry keeps checkpoints, refuses ready', async () => {
  const { POST: retry } = await import('@/app/api/projects/[id]/retry/route')
  const p = await (await create()).json()
  const d = await db()
  await d.job.updateMany({ where: { projectId: p.id }, data: { status: 'failed', stageDone: '["importing"]' } })
  await d.project.update({ where: { id: p.id }, data: { status: 'failed' } })
  const res = await retry(new Request('http://x'), ctx({ id: p.id }))
  expect(res.status).toBe(200)
  const jobs = await d.job.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' } })
  expect(jobs).toHaveLength(2)
  expect(jobs[0].status).toBe('queued')
  expect(jobs[0].stageDone).toBe('["importing"]')
  await d.project.update({ where: { id: p.id }, data: { status: 'ready' } })
  expect((await retry(new Request('http://x'), ctx({ id: p.id }))).status).toBe(409)
})

test('delete removes media, refuses while running', async () => {
  const { DELETE } = await import('@/app/api/projects/[id]/route')
  const p = await (await create()).json()
  const media = join(dir, 'media', p.id)
  mkdirSync(media, { recursive: true }); writeFileSync(join(media, 'x.txt'), 'x')
  await (await db()).job.updateMany({ where: { projectId: p.id }, data: { status: 'running' } })
  expect((await DELETE(new Request('http://x'), ctx({ id: p.id }))).status).toBe(409)
  await (await db()).job.updateMany({ where: { projectId: p.id }, data: { status: 'failed' } })
  expect((await DELETE(new Request('http://x'), ctx({ id: p.id }))).status).toBe(204)
  expect(existsSync(media)).toBe(false)
})

test('events streams final state then closes', async () => {
  const { GET } = await import('@/app/api/projects/[id]/events/route')
  const p = await (await create()).json()
  const d = await db()
  await d.job.updateMany({ where: { projectId: p.id }, data: { status: 'done', progress: 1 } })
  await d.project.update({ where: { id: p.id }, data: { status: 'ready' } })
  const res = await GET(new Request('http://x'), ctx({ id: p.id }))
  expect(res.headers.get('content-type')).toContain('text/event-stream')
  const text = await res.text()
  expect(text).toContain('"status":"ready"')
})

test('list and thumbnail url', async () => {
  const p = await (await create()).json()
  mkdirSync(join(dir, 'media', p.id), { recursive: true }); writeFileSync(join(dir, 'media', p.id, 'thumb.jpg'), 'x')
  const { GET } = await import('@/app/api/projects/route')
  const list = await (await GET()).json()
  expect(list[0].thumbnailUrl).toBe(`/api/files/media/${p.id}/thumb.jpg`)
  const { GET: file } = await import('@/app/api/files/[...path]/route')
  expect((await file(new Request('http://x'), ctx({ path: ['media', p.id, 'thumb.jpg'] }))).status).toBe(200)
  expect((await file(new Request('http://x'), ctx({ path: ['media', p.id, 'audio.wav'] }))).status).toBe(404)
})

test('analyze requires a transcript and no active job', async () => {
  const { POST: analyze } = await import('@/app/api/projects/[id]/analyze/route')
  const p = await (await create()).json()
  expect((await analyze(new Request('http://x'), ctx({ id: p.id }))).status).toBe(409) // no transcript, and the ingest job is queued
  const d = await db()
  await d.job.updateMany({ where: { projectId: p.id }, data: { status: 'done' } })
  mkdirSync(join(dir, 'media', p.id), { recursive: true }); writeFileSync(join(dir, 'media', p.id, 'transcript.json'), '{"words":[]}')
  const res = await analyze(new Request('http://x'), ctx({ id: p.id }))
  expect(res.status).toBe(200)
  const jobs = await d.job.findMany({ where: { projectId: p.id, type: 'analyze' } })
  expect(jobs).toHaveLength(1)
  expect((await analyze(new Request('http://x'), ctx({ id: p.id }))).status).toBe(409) // busy
})

test('search validates the query and creates a search job with payload', async () => {
  const { POST: search } = await import('@/app/api/projects/[id]/search/route')
  const p = await (await create()).json()
  const d = await db()
  await d.job.updateMany({ where: { projectId: p.id }, data: { status: 'done' } })
  mkdirSync(join(dir, 'media', p.id), { recursive: true }); writeFileSync(join(dir, 'media', p.id, 'transcript.json'), '{"words":[]}')
  const req = (q: string) => new Request('http://x', { method: 'POST', body: JSON.stringify({ query: q }) })
  expect((await search(req('ab'), ctx({ id: p.id }))).status).toBe(400)
  expect((await search(req('blind dates'), ctx({ id: p.id }))).status).toBe(200)
  const job = await d.job.findFirst({ where: { projectId: p.id, type: 'search' } })
  expect(JSON.parse(job!.payload!)).toEqual({ query: 'blind dates' })
  expect((await search(req('again'), ctx({ id: p.id }))).status).toBe(409)
})
