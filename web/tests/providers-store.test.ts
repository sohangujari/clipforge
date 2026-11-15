import { beforeEach, expect, test, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { freshDb } from './helpers'

let dir: string
beforeEach(() => { dir = freshDb(); vi.resetModules() })
const store = () => import('@/lib/providers-store')

test('trims key', async () => {
  const { saveProvider, loadProviderConfig } = await store()
  const view = await saveProvider('openai', { apiKey: '  sk-123456\n' })
  expect((await loadProviderConfig('openai')).apiKey).toBe('sk-123456')
  expect(view.keyHint).toBe('••••3456')
})

test('blank key keeps existing', async () => {
  const { saveProvider, loadProviderConfig } = await store()
  await saveProvider('openai', { apiKey: 'sk-123456' })
  await saveProvider('openai', { apiKey: '', baseUrl: 'https://x/v1' })
  const cfg = await loadProviderConfig('openai')
  expect(cfg.apiKey).toBe('sk-123456')
  expect(cfg.baseUrl).toBe('https://x/v1')
})

test('undecryptable key', async () => {
  await (await store()).saveProvider('openai', { apiKey: 'sk-123456' })
  rmSync(join(dir, '.secret'))
  vi.resetModules()
  const views = await (await store()).listProviderViews()
  expect(views.find((v) => v.kind === 'openai')?.needsKey).toBe(true)
})

test('never leaks key', async () => {
  await (await store()).saveProvider('openai', { apiKey: 'sk-123456' })
  const { GET } = await import('@/app/api/providers/route')
  const text = await (await GET()).text()
  expect(text).not.toContain('sk-123456')
  expect(text).toContain('3456')
})

test('ollama default', async () => {
  const views = await (await store()).listProviderViews()
  expect(views.map((v) => v.kind)).toEqual(['anthropic', 'openai', 'google', 'ollama', 'custom'])
  expect(views.find((v) => v.kind === 'ollama')?.baseUrl).toBe('http://localhost:11434')
  expect(views.find((v) => v.kind === 'ollama')?.needsKey).toBe(false)
  expect(views.find((v) => v.kind === 'anthropic')?.needsKey).toBe(true)
})

test('unknown provider kind → 404', async () => {
  const { PUT } = await import('@/app/api/providers/[kind]/route')
  const res = await PUT(new Request('http://x', { method: 'PUT', body: '{}' }), { params: Promise.resolve({ kind: 'nope' }) })
  expect(res.status).toBe(404)
})
