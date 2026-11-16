import { beforeEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshDb } from './helpers'

let dir: string
beforeEach(() => { dir = freshDb(); vi.resetModules() })

const settings = { clipCount: 'auto', lengthRange: [30, 90], language: 'auto', tone: 'neutral', vocabulary: [], captionScript: 'native' }
const meta = { name: 'a.mp4', size: 20, lastModified: 1 }
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const routes = async () => ({
  init: (await import('@/app/api/uploads/route')).POST,
  chunk: (await import('@/app/api/uploads/[id]/route')).PATCH,
  offset: (await import('@/app/api/uploads/[id]/route')).GET,
  complete: (await import('@/app/api/uploads/[id]/complete/route')).POST,
})
const json = (b: unknown) => ({ method: 'POST', body: JSON.stringify(b) })
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)
const patch = (id: string, offset: number, body: Uint8Array) =>
  new Request(`http://x/api/uploads/${id}?offset=${offset}`, { method: 'PATCH', body: body as BodyInit, duplex: 'half' } as RequestInit)

test('full upload creates a project with the file in media/', async () => {
  const r = await routes()
  const { uploadId, offset } = await (await r.init(new Request('http://x', json(meta)))).json()
  expect(offset).toBe(0)
  expect((await (await r.chunk(patch(uploadId, 0, bytes(10, 1)), ctx(uploadId))).json()).offset).toBe(10)
  expect((await (await r.chunk(patch(uploadId, 10, bytes(10, 2)), ctx(uploadId))).json()).offset).toBe(20)
  const res = await r.complete(new Request('http://x', json({ settings })), ctx(uploadId))
  expect(res.status).toBe(201)
  const p = await res.json()
  expect(p.status).toBe('queued')
  expect(p.title).toBe('a')
  const file = readFileSync(join(dir, 'media', p.id, 'source.mp4'))
  expect(file.length).toBe(20)
  expect(file[0]).toBe(1); expect(file[19]).toBe(2)
})

test('resume from reported offset', async () => {
  const r = await routes()
  const a = await (await r.init(new Request('http://x', json(meta)))).json()
  await r.chunk(patch(a.uploadId, 0, bytes(10, 1)), ctx(a.uploadId))
  const b = await (await r.init(new Request('http://x', json(meta)))).json()
  expect(b).toEqual({ uploadId: a.uploadId, offset: 10 })
  expect(await (await r.offset(new Request('http://x'), ctx(a.uploadId))).json()).toEqual({ offset: 10, size: 20 })
})

test('wrong offset → 409 with server offset', async () => {
  const r = await routes()
  const { uploadId } = await (await r.init(new Request('http://x', json(meta)))).json()
  await r.chunk(patch(uploadId, 0, bytes(10, 1)), ctx(uploadId))
  const res = await r.chunk(patch(uploadId, 5, bytes(5, 1)), ctx(uploadId))
  expect(res.status).toBe(409)
  expect((await res.json()).offset).toBe(10)
})

test('rejects bad type, oversize, and overflowing chunk', async () => {
  const r = await routes()
  expect((await r.init(new Request('http://x', json({ ...meta, name: 'x.exe' })))).status).toBe(400)
  expect((await r.init(new Request('http://x', json({ ...meta, size: 21e9 })))).status).toBe(400)
  const { uploadId } = await (await r.init(new Request('http://x', json(meta)))).json()
  expect((await r.chunk(patch(uploadId, 0, bytes(25, 1)), ctx(uploadId))).status).toBe(413)
})

test('complete before done → 409; unknown upload id → 404', async () => {
  const r = await routes()
  const { uploadId } = await (await r.init(new Request('http://x', json(meta)))).json()
  expect((await r.complete(new Request('http://x', json({ settings })), ctx(uploadId))).status).toBe(409)
  expect((await r.offset(new Request('http://x'), ctx('../../etc'))).status).toBe(404)
})

test('re-uploading the same file after completion starts fresh', async () => {
  const r = await routes()
  const { uploadId } = await (await r.init(new Request('http://x', json(meta)))).json()
  await r.chunk(patch(uploadId, 0, bytes(20, 1)), ctx(uploadId))
  await r.complete(new Request('http://x', json({ settings })), ctx(uploadId))
  expect(await (await r.init(new Request('http://x', json(meta)))).json()).toEqual({ uploadId, offset: 0 })
})

test('resume after a server kill mid-chunk discards bytes past the recorded offset', async () => {
  const r = await routes()
  const { uploadId } = await (await r.init(new Request('http://x', json(meta)))).json()
  await r.chunk(patch(uploadId, 0, bytes(10, 1)), ctx(uploadId))
  const { appendFileSync } = await import('node:fs')
  appendFileSync(join(dir, 'uploads', `${uploadId}.part`), bytes(7, 9)) // written, but the server died before saving the offset
  await r.chunk(patch(uploadId, 10, bytes(10, 2)), ctx(uploadId))
  const p = await (await r.complete(new Request('http://x', json({ settings })), ctx(uploadId))).json()
  const file = readFileSync(join(dir, 'media', p.id, 'source.mp4'))
  expect(file.length).toBe(20)
  expect([...file.subarray(10)]).toEqual(Array(10).fill(2))
})
