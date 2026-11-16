import { beforeEach, expect, test, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { freshDb } from './helpers'

let dir: string
beforeEach(() => { dir = freshDb(); vi.resetModules() })
const ctx = <T extends Record<string, unknown>>(p: T) => ({ params: Promise.resolve(p) })
const db = async () => (await import('@/lib/db')).getDb()
const settings = { clipCount: 'auto', lengthRange: [30, 90], language: 'auto', tone: 'neutral', vocabulary: [], captionScript: 'native' }

async function projectWithClips() {
  const { createProject } = await import('@/lib/projects')
  const p = await createProject({ sourceType: 'url', url: 'https://x.test/v', settings: settings as never, contentType: 'podcast' })
  const m = join(dir, 'media', p.id)
  mkdirSync(m, { recursive: true })
  writeFileSync(join(m, 'transcript.json'), JSON.stringify({ language: 'en', words: [
    { w: 'Hello', s: 10, e: 10.4 }, { w: 'world.', s: 10.5, e: 11 }, { w: 'Later', s: 50, e: 50.5 }] }))
  const base = { breakdown: '{"hook":80,"emotion":70,"value":60,"pacing":70,"trend":50,"reasons":{}}', reason: 'r', tips: '[]',
    titles: '["T1","T2","T3"]', descriptions: '{"shorts":"s","tiktok":"t","reels":"r"}', hashtags: '["#a"]', signals: '{}' }
  const d = await db()
  const ids = [randomUUID(), randomUUID(), randomUUID()]
  await d.clip.createMany({ data: [
    { id: ids[0], projectId: p.id, startSec: 10, endSec: 40, score: 70, ...base },
    { id: ids[1], projectId: p.id, startSec: 45, endSec: 80, score: 90, ...base },
    { id: ids[2], projectId: p.id, startSec: 0, endSec: 30, score: 99, status: 'deleted', ...base },
  ] })
  return { p, ids }
}

test('lists clips sorted by score, hides deleted, slices transcript', async () => {
  const { p, ids } = await projectWithClips()
  const { GET } = await import('@/app/api/projects/[id]/clips/route')
  const body = await (await GET(new Request('http://x'), ctx({ id: p.id }))).json()
  expect(body.clips.map((c: { id: string }) => c.id)).toEqual([ids[1], ids[0]])
  expect(body.clips[1].transcript.map((w: { w: string }) => w.w)).toEqual(['Hello', 'world.'])
  expect(body.clips[1].titles).toEqual(['T1', 'T2', 'T3'])
  expect(body.tasteCount).toBe(0)
})

test('PATCH kept writes feedback with summary', async () => {
  const { ids } = await projectWithClips()
  const { PATCH } = await import('@/app/api/clips/[id]/route')
  const res = await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'kept' }) }), ctx({ id: ids[0] }))
  expect(res.status).toBe(200)
  const fb = await (await db()).clipFeedback.findMany()
  expect(fb).toHaveLength(1)
  expect(fb[0]).toMatchObject({ action: 'kept', contentType: 'podcast' })
  expect(fb[0].summary).toContain('T1')
  expect(fb[0].summary).toContain('Hello world.')
})

test('PATCH rejects bad status', async () => {
  const { ids } = await projectWithClips()
  const { PATCH } = await import('@/app/api/clips/[id]/route')
  expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'nope' }) }), ctx({ id: ids[0] }))).status).toBe(400)
})

test('range request returns 206 with the right bytes; source and transcript not served', async () => {
  const { p } = await projectWithClips()
  const m = join(dir, 'media', p.id)
  writeFileSync(join(m, 'proxy.mp4'), Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)))
  writeFileSync(join(m, 'source.mp4'), 'x')
  const cid = randomUUID(); mkdirSync(join(m, 'clips')); writeFileSync(join(m, 'clips', `${cid}.jpg`), 'j')
  const { GET } = await import('@/app/api/files/[...path]/route')
  const get = (path: string[], headers: Record<string, string> = {}) => GET(new Request('http://x', { headers }), ctx({ path }))
  const r = await get(['media', p.id, 'proxy.mp4'], { range: 'bytes=100-199' })
  expect(r.status).toBe(206)
  expect(r.headers.get('content-range')).toBe('bytes 100-199/1000')
  const b = new Uint8Array(await r.arrayBuffer())
  expect(b.length).toBe(100); expect(b[0]).toBe(100)
  expect((await get(['media', p.id, 'proxy.mp4'])).headers.get('accept-ranges')).toBe('bytes')
  expect((await get(['media', p.id, 'clips', `${cid}.jpg`])).status).toBe(200)
  expect((await get(['media', p.id, 'source.mp4'])).status).toBe(404)
  expect((await get(['media', p.id, 'transcript.json'])).status).toBe(404)
})

test('project view includes clipCount', async () => {
  const { p } = await projectWithClips()
  const { getProject } = await import('@/lib/projects')
  expect((await getProject(p.id))!.clipCount).toBe(2)
})
