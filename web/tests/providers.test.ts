import { afterEach, expect, test, vi } from 'vitest'
import { listModels } from '@/lib/ai/providers'
import { ProviderError } from '@/lib/ai/errors'

const GiB = 2 ** 30
afterEach(() => vi.unstubAllGlobals())

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
  fn.mockImplementation(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

test('anthropic parses models and sends headers', async () => {
  const f = stubFetch({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }] })
  expect(await listModels({ kind: 'anthropic', apiKey: 'k' })).toEqual([{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }])
  const [url, init] = f.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000')
  expect((init.headers as Record<string, string>)['x-api-key']).toBe('k')
  expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01')
})

test('openai parses models', async () => {
  stubFetch({ data: [{ id: 'gpt-5' }] })
  expect(await listModels({ kind: 'openai', apiKey: 'k' })).toEqual([{ id: 'gpt-5', label: 'gpt-5' }])
})

test('google keeps generateContent models and strips prefix', async () => {
  stubFetch({ models: [
    { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', displayName: 'Embed', supportedGenerationMethods: ['embedContent'] },
  ] })
  expect(await listModels({ kind: 'google', apiKey: 'k' })).toEqual([{ id: 'gemini-3-pro', label: 'Gemini 3 Pro' }])
})

test('cloudflare lists text models from its search endpoint and only ever calls api.cloudflare.com', async () => {
  const f = stubFetch({ success: true, result: [{ name: '@cf/openai/gpt-oss-120b' }, { name: '@cf/google/gemma-4-26b-a4b-it' }] })
  expect(await listModels({ kind: 'cloudflare', apiKey: 'tok', baseUrl: ' 0123abcd ' })).toEqual([
    { id: '@cf/openai/gpt-oss-120b', label: '@cf/openai/gpt-oss-120b' }, { id: '@cf/google/gemma-4-26b-a4b-it', label: '@cf/google/gemma-4-26b-a4b-it' }])
  const [url, init] = f.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/0123abcd/ai/models/search?task=Text%20Generation&per_page=100')
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  await listModels({ kind: 'cloudflare', apiKey: 'tok', baseUrl: 'evil.test/x?' })
  expect(new URL(f.mock.calls[1][0] as string).host).toBe('api.cloudflare.com') // the account ID can't redirect the token
})

test('custom uses base url', async () => {
  const f = stubFetch({ data: [{ id: 'llama-3' }] })
  expect(await listModels({ kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1/' })).toEqual([{ id: 'llama-3', label: 'llama-3' }])
  expect(f.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models')
})

test('ollama ramWarning', async () => {
  stubFetch({ models: [{ name: 'big:8b', size: 5e9 }, { name: 'qwen3.5:2b', size: 2.7e9 }] })
  const on8 = await listModels({ kind: 'ollama' }, { totalMem: 8 * GiB })
  expect(on8.map((m) => m.ramWarning)).toEqual([true, false])
  const on16 = await listModels({ kind: 'ollama' }, { totalMem: 16 * GiB })
  expect(on16[0].ramWarning).toBe(false)
  expect(on8[1]).toMatchObject({ id: 'qwen3.5:2b', sizeBytes: 2.7e9 })
})

test('401 → invalid_key', async () => {
  stubFetch({ error: 'nope' }, 401)
  await expect(listModels({ kind: 'openai', apiKey: 'bad' })).rejects.toMatchObject({ code: 'invalid_key' })
})

test('429 → rate_limited', async () => {
  stubFetch({}, 429)
  await expect(listModels({ kind: 'anthropic', apiKey: 'k' })).rejects.toMatchObject({ code: 'rate_limited' })
})

test('unreachable within timeout', async () => {
  const t = Date.now()
  const err = await listModels({ kind: 'ollama', baseUrl: 'http://127.0.0.1:9' }).catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err.code).toBe('unreachable')
  expect(err.userMessage).toContain('ollama serve')
  expect(Date.now() - t).toBeLessThan(6000)
})

test('ollama wrong path (404) → unreachable with base-url hint, not model_not_found', async () => {
  stubFetch({}, 404)
  const err = await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434/v2' }).catch((e) => e)
  expect(err.code).toBe('unreachable')
  expect(err.userMessage).toMatch(/base URL/i)
})

test('ollama base url with trailing /v1 is normalised', async () => {
  const f = stubFetch({ models: [] })
  await listModels({ kind: 'ollama', baseUrl: 'http://localhost:11434/v1/' })
  expect(f.mock.calls[0][0]).toBe('http://localhost:11434/api/tags')
})

test('non-JSON response (HTML page) → unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>hi</html>', { status: 200 })))
  const err = await listModels({ kind: 'custom', baseUrl: 'http://example.test' }).catch((e) => e)
  expect(err.code).toBe('unreachable')
  expect(err.userMessage).toMatch(/base URL/i)
})

test('testConnection with a model times out instead of hanging', async () => {
  const { testConnection } = await import('@/lib/ai/providers')
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [] }))
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
  }))
  const t = Date.now()
  const r = await testConnection({ kind: 'ollama' }, 'big:8b', { timeoutMs: 300 })
  expect(r.ok).toBe(false)
  expect(Date.now() - t).toBeLessThan(3000)
})
