import { beforeEach, expect, test, vi } from 'vitest'
import { freshDb } from './helpers'

vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateText: vi.fn(async () => ({ output: { words: ['namaste'] } })) }))

beforeEach(() => { freshDb(); vi.resetModules() })

const call = async (body: unknown, token?: string) => {
  const { POST } = await import('@/app/api/internal/llm/route')
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: token ? { 'X-ClipForge-Token': token } : {} }))
}
const token = async () => (await import('@/lib/worker-token')).getWorkerToken()
const hinglish = { task: 'hinglish', input: { words: ['नमस्ते'] } }

test('401 without or with a wrong token', async () => {
  expect((await call(hinglish)).status).toBe(401)
  expect((await call(hinglish, 'nope')).status).toBe(401)
})

test('400 unknown task or bad input', async () => {
  const t = await token()
  expect((await call({ task: 'nope', input: {} }, t)).status).toBe(400)
  expect((await call({ task: 'hinglish', input: { words: 'x' } }, t)).status).toBe(400)
})

test('424 when no model is configured', async () => {
  const res = await call(hinglish, await token())
  expect(res.status).toBe(424)
  expect((await res.json()).error).toBe('no_model')
})

test('200 with a configured model (titles slot, then highlight)', async () => {
  const { setSetting } = await import('@/lib/settings')
  // cloud provider → generic AI SDK path (Ollama has its own native path, covered in llm-tasks.test.ts)
  await setSetting('aiTasks', { highlight: { provider: 'google', model: 'gemini-flash' }, scoring: null, titles: null, vision: null })
  const res = await call(hinglish, await token())
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ output: { words: ['namaste'] } })
})

test('token file is private', async () => {
  const { statSync } = await import('node:fs')
  const { join } = await import('node:path')
  await token()
  expect(statSync(join(process.env.CLIPFORGE_DATA_DIR!, '.worker-token')).mode & 0o777).toBe(0o600)
})
