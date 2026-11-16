import { beforeEach, expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshDb } from './helpers'

const gen = vi.fn()
vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateText: (...a: unknown[]) => gen(...a) }))

let dir: string
beforeEach(() => { dir = freshDb(); vi.resetModules(); gen.mockReset() })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const settings = { clipCount: 'auto', lengthRange: [30, 90], language: 'auto', tone: 'neutral', vocabulary: [], captionScript: 'native' }

async function setup(provider: 'google' | 'ollama') {
  const { setSetting } = await import('@/lib/settings')
  await setSetting('aiTasks', { highlight: { provider, model: 'm' }, scoring: null, titles: null, vision: null })
  const { createProject } = await import('@/lib/projects')
  const p = await createProject({ sourceType: 'url', url: 'https://x.test/v', settings: settings as never })
  mkdirSync(join(dir, 'media', p.id), { recursive: true })
  writeFileSync(join(dir, 'media', p.id, 'transcript.json'), JSON.stringify({ language: 'en', words: [{ w: 'Hello', s: 1, e: 1.5 }, { w: 'world.', s: 1.6, e: 2 }] }))
  const { getDb } = await import('@/lib/db')
  const id = randomUUID()
  await getDb().clip.create({ data: { id, projectId: p.id, startSec: 0, endSec: 30, score: 70, breakdown: '{}', reason: 'r', tips: '[]',
    titles: '["Old","Old2","Old3"]', descriptions: '{"shorts":"os","tiktok":"ot","reels":"or"}', hashtags: '["#old"]', signals: '{}' } })
  return { p, id, db: getDb() }
}
const regen = async (id: string, field: string) => {
  const { POST } = await import('@/app/api/clips/[id]/regenerate/route')
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ field }) }), ctx(id))
}
const meta = { items: [{ key: '0', titles: ['New A', 'New B', 'New C'], descriptions: { shorts: 'ns', tiktok: 'nt', reels: 'nr' }, hashtags: ['#a', '#b', '#c', '#d', '#e'] }] }

test('regenerates only the requested field', async () => {
  const { id } = await setup('google')
  gen.mockResolvedValue({ output: meta })
  const res = await regen(id, 'titles')
  expect(res.status).toBe(200)
  const c = await res.json()
  expect(c.titles).toEqual(['New A', 'New B', 'New C'])
  expect(c.descriptions.shorts).toBe('os')
  expect(c.hashtags).toEqual(['#old'])
  expect(gen.mock.calls[0][0].prompt).toContain('Hello world.')
})

test('423 when the model is local and a video is processing', async () => {
  const { p, id, db } = await setup('ollama')
  await db.job.updateMany({ where: { projectId: p.id }, data: { status: 'running' } })
  const res = await regen(id, 'hashtags')
  expect(res.status).toBe(423)
  expect((await res.json()).error).toMatch(/local model is busy/)
})

test('cloud provider runs while a video is processing', async () => {
  const { p, id, db } = await setup('google')
  await db.job.updateMany({ where: { projectId: p.id }, data: { status: 'running' } })
  gen.mockResolvedValue({ output: meta })
  expect((await regen(id, 'descriptions')).status).toBe(200)
})

test('400 for a bad field, 404 for a missing clip', async () => {
  const { id } = await setup('google')
  expect((await regen(id, 'nope')).status).toBe(400)
  expect((await regen(randomUUID(), 'titles')).status).toBe(404)
})
