import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { freshDb } from './helpers'

const gen = vi.fn()
vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateText: (...a: unknown[]) => gen(...a) }))

beforeEach(async () => {
  freshDb(); vi.resetModules(); gen.mockReset()
  const { setSetting } = await import('@/lib/settings')
  await setSetting('aiTasks', { highlight: { provider: 'google', model: 'gemini-flash' }, scoring: null, titles: { provider: 'google', model: 'gemini-flash-lite' }, vision: null })
})
afterEach(() => vi.unstubAllGlobals())

const call = async (task: string, input: unknown) => {
  const { getWorkerToken } = await import('@/lib/worker-token')
  const { POST } = await import('@/app/api/internal/llm/route')
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ task, input }), headers: { 'X-ClipForge-Token': getWorkerToken() } }))
}
const sentences = [{ id: 0, t: '0:00', text: 'You did a research, right?', cues: [] }, { id: 1, t: '0:05', text: 'We set up blind dates.', cues: ['laughter'] }]

test('highlights: valid output, prompt has type focus, cues and taste examples; contentType when detecting', async () => {
  gen.mockResolvedValue({ output: { contentType: 'podcast', candidates: [{ startId: 0, endId: 1, hookId: 1, why: 'funny', kind: 'joke' }] } })
  const res = await call('highlights', { contentType: 'podcast', detectType: true, tone: 'neutral', lengthRange: [30, 90], sentences,
    examples: { kept: ['“Blind dates” — students on dates'], deleted: ['“Intro” — welcome back'] } })
  expect(res.status).toBe(200)
  expect((await res.json()).output.contentType).toBe('podcast')
  const { system, prompt } = gen.mock.calls[0][0]
  expect(system).toMatch(/strong opinions/i)
  expect(system).toMatch(/kept/i)
  expect(prompt).toContain('[1] 0:05 (laughter) We set up blind dates.')
  expect(system + prompt).toContain('Blind dates')
})

test('one over-long or slightly-off field is trimmed, not a failed batch', async () => {
  const { LLM_TASKS } = await import('@/lib/llm-tasks')
  const meta = LLM_TASKS.metadata.output.parse({ items: [{ key: 'a', titles: ['x'.repeat(80), 'Two', 'Three', 'Four'],
    descriptions: { shorts: 's'.repeat(900), tiktok: 't', reels: 'r' }, hashtags: ['#a', 'b', '#c d', '#d', '#e', '#f', '#g', '#h', '#i', '#j', '#k', '#'] }] }).items[0]
  expect(meta.titles).toEqual(['x'.repeat(60), 'Two', 'Three'])
  expect(meta.descriptions.shorts).toHaveLength(500)
  expect(meta.hashtags).toEqual(['#a', '#b', '#cd', '#d', '#e', '#f', '#g', '#h', '#i', '#j'])
  const hl = LLM_TASKS.highlights.output.parse({ contentType: 'cooking', candidates: [{ startId: 0, endId: 1, hookId: 0, why: 'w'.repeat(300), kind: 'rant' }] })
  expect(hl.contentType).toBeUndefined()
  expect(hl.candidates[0]).toMatchObject({ kind: 'moment', why: 'w'.repeat(200) })
  const sc = LLM_TASKS.score.output.parse({ scores: [{ key: 'a', hook: 105, emotion: -3, value: 60, pacing: 75, trend: 40, extra: { q: 130 }, reasons: { hook: 'r'.repeat(400) }, summary: 's'.repeat(400), tips: ['1', '2', '3', '4'] }] }).scores[0]
  expect(sc).toMatchObject({ hook: 100, emotion: 0, extra: { q: 100 }, summary: 's'.repeat(240), tips: ['1', '2', '3'] })
  expect(sc.reasons.hook).toHaveLength(160)
})

test('OpenAI gets non-strict JSON schema (strict mode rejects optional fields and records)', async () => {
  gen.mockResolvedValue({ output: { scores: [] } })
  await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  expect(gen.mock.calls[0][0].providerOptions).toMatchObject({ openai: { strictJsonSchema: false } })
})

test('score validates through the route', async () => {
  gen.mockResolvedValue({ output: { scores: [{ key: 'a', hook: 80, emotion: 70, value: 60, pacing: 75, trend: 40, extra: { quotability: 70 }, reasons: { hook: 'Opens on a question' }, summary: 's', tips: ['t'] }] } })
  const res = await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  expect(res.status).toBe(200)
})

test('JSON wrapped in fences or chatter is still used instead of failing the part', async () => {
  const { NoObjectGeneratedError } = await import('ai')
  const text = 'Here you go:\n```json\n{"scores": [{"key": "a", "hook": 80, "emotion": 70, "value": 60, "pacing": 75, "trend": 40, "summary": "s"}]}\n```'
  gen.mockRejectedValueOnce(new NoObjectGeneratedError({ message: 'No object generated: could not parse the response.', text, response: { id: 'x', timestamp: new Date(), modelId: 'm' }, usage: {} as never, finishReason: 'stop' }))
  const res = await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  expect(res.status).toBe(200)
  expect((await res.json()).output.scores[0].hook).toBe(80)
})

test('bad input is 400', async () => {
  expect((await call('highlights', { sentences: 'nope' })).status).toBe(400)
  expect((await call('search', { query: 'x', sentences })).status).toBe(400) // query too short
})

test('info is free and reports local vs cloud', async () => {
  const res = await call('info', {})
  expect(await res.json()).toEqual({ output: { local: false, provider: 'google', model: 'gemini-flash' } })
  expect(gen).not.toHaveBeenCalled()
})

test('ollama uses the native api with think false, num_ctx 4096 and a JSON schema format', async () => {
  const { setSetting } = await import('@/lib/settings')
  await setSetting('aiTasks', { highlight: { provider: 'ollama', model: 'qwen3.5:4b' }, scoring: null, titles: null, vision: null })
  const fetchMock = vi.fn(async () => Response.json({ message: { content: JSON.stringify({ candidates: [] }) } }))
  vi.stubGlobal('fetch', fetchMock)
  const res = await call('highlights', { contentType: 'podcast', tone: 'neutral', lengthRange: [30, 90], sentences, examples: { kept: [], deleted: [] } })
  expect(res.status).toBe(200)
  expect(res.headers.get('x-clipforge-local')).toBe('1')
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('http://localhost:11434/api/chat')
  const body = JSON.parse(init.body as string)
  expect(body).toMatchObject({ model: 'qwen3.5:4b', stream: false, think: false, keep_alive: 0, options: { num_ctx: 4096 } })
  expect(body.format.type).toBe('object')
  expect(gen).not.toHaveBeenCalled()
})

test('ollama answer cut off at the context limit is an error, not a silent partial answer', async () => {
  const { setSetting } = await import('@/lib/settings')
  await setSetting('aiTasks', { highlight: { provider: 'ollama', model: 'qwen3.5:2b' }, scoring: null, titles: null, vision: null })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ done_reason: 'length', message: { content: JSON.stringify({ candidates: [] }) } })))
  const res = await call('highlights', { contentType: 'podcast', tone: 'neutral', lengthRange: [30, 90], sentences, examples: { kept: [], deleted: [] } })
  expect(res.status).toBe(502)
  expect((await res.json()).error).toMatch(/too long/i)
})

test('OpenAI-compatible providers get the JSON schema spelled out (many ignore response_format)', async () => {
  const { setSetting } = await import('@/lib/settings')
  const { saveProvider } = await import('@/lib/providers-store')
  await saveProvider('cloudflare', { apiKey: 'tok', baseUrl: 'abc', enabled: true })
  await setSetting('aiTasks', { highlight: null, scoring: { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it' }, titles: null, vision: null })
  gen.mockResolvedValue({ output: { scores: [] } })
  expect((await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })).status).toBe(200)
  expect(gen.mock.calls[0][0].system).toMatch(/JSON schema[\s\S]*"scores"/)
  expect(gen.mock.calls[0][0].maxOutputTokens).toBeGreaterThanOrEqual(8000) // Cloudflare's small default ran out mid-reasoning: empty answer
  expect(gen.mock.calls[0][0].providerOptions.cloudflare).toEqual({ chat_template_kwargs: { enable_thinking: false } }) // scoring: 24 s → 2 s
  await setSetting('aiTasks', { highlight: { provider: 'cloudflare', model: '@cf/openai/gpt-oss-120b' }, scoring: null, titles: null, vision: null })
  gen.mockResolvedValue({ output: { candidates: [] } })
  await call('highlights', { contentType: 'podcast', tone: 'neutral', lengthRange: [30, 90], sentences, examples: { kept: [], deleted: [] } })
  expect(gen.mock.calls.at(-1)![0].providerOptions.cloudflare).toBeUndefined() // highlights keep thinking: that's the judgment call
  gen.mockResolvedValue({ output: { scores: [] } })
  await setSetting('aiTasks', { highlight: null, scoring: { provider: 'google', model: 'g' }, titles: null, vision: null })
  await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  expect(gen.mock.calls.at(-1)![0].system).not.toMatch(/JSON schema/) // native structured output: no extra tokens
})

test('unload calls ollama only for ollama providers', async () => {
  const fetchMock = vi.fn(async () => Response.json({}))
  vi.stubGlobal('fetch', fetchMock)
  expect((await (await call('unload', {})).json()).output.unloaded).toBe(false)
  const { setSetting } = await import('@/lib/settings')
  await setSetting('aiTasks', { highlight: { provider: 'ollama', model: 'qwen3.5:4b' }, scoring: null, titles: null, vision: null })
  expect((await (await call('unload', {})).json()).output.unloaded).toBe(true)
  expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ model: 'qwen3.5:4b', keep_alive: 0 })
})

test('provider 429 maps to rate_limited with retryAfter, daily quota to quota', async () => {
  const { APICallError } = await import('ai')
  const err = (body: string, headers: Record<string, string> = {}) => new APICallError({ message: 'Too Many Requests', url: 'x', requestBodyValues: {}, statusCode: 429, responseHeaders: headers, responseBody: body, isRetryable: true })
  gen.mockRejectedValueOnce(err('{"error":{"details":[{"retryDelay":"42s"}]}}'))
  const r1 = await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  expect(r1.status).toBe(429)
  expect(await r1.json()).toMatchObject({ error: 'rate_limited', retryAfter: 42 })
  gen.mockRejectedValueOnce(err('{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}'))
  const r2 = await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  expect(r2.status).toBe(429)
  expect((await r2.json()).error).toBe('quota')
  gen.mockRejectedValueOnce(err('{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}'))
  const r3 = await (await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })).json()
  expect(r3).toMatchObject({ error: 'quota', message: expect.stringMatching(/credit|billing/i) }) // OpenAI out of credit: waiting won't help
})

test("each request increments today's usage", async () => {
  gen.mockResolvedValue({ output: { scores: [] } })
  await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  const { todayUsage } = await import('@/lib/llm-usage')
  expect(await todayUsage()).toEqual({ 'google:gemini-flash': 2 })
})

test('brief scoring asks for short reasons', async () => {
  const { LLM_TASKS } = await import('@/lib/llm-tasks')
  const input = LLM_TASKS.score.input.parse({ contentType: 'podcast', brief: true, clips: [{ key: '0', text: 'x' }] })
  expect(LLM_TASKS.score.system(input)).toMatch(/under 10 words/)
  expect(LLM_TASKS.score.system(LLM_TASKS.score.input.parse({ contentType: 'podcast', clips: [{ key: '0', text: 'x' }] }))).not.toMatch(/under 10 words/)
})

test('output schemas avoid tuples (Gemini rejects array-form "items")', async () => {
  const { z } = await import('zod')
  const { LLM_TASKS } = await import('@/lib/llm-tasks')
  const walk = (s: unknown, path: string): string[] => {
    if (!s || typeof s !== 'object') return []
    const o = s as Record<string, unknown>
    const bad = Array.isArray(o.items) || 'prefixItems' in o ? [path] : []
    return [...bad, ...Object.entries(o).flatMap(([k, v]) => walk(v, `${path}.${k}`))]
  }
  for (const [name, t] of Object.entries(LLM_TASKS)) expect(walk(z.toJSONSchema(t.output), name)).toEqual([])
  const ok = { items: [{ key: '0', titles: ['a', 'b', 'c'], descriptions: { shorts: 's', tiktok: 't', reels: 'r' }, hashtags: ['#a', '#b', '#c', '#d', '#e'] }] }
  expect(LLM_TASKS.metadata.output.safeParse(ok).success).toBe(true)
  expect(LLM_TASKS.metadata.output.safeParse({ items: [{ ...ok.items[0], titles: [] }] }).success).toBe(false)
})

test('provider overloaded (503 / high demand) maps to busy with a retry delay', async () => {
  const { APICallError } = await import('ai')
  gen.mockRejectedValueOnce(new APICallError({ message: 'This model is currently experiencing high demand.', url: 'x', requestBodyValues: {}, statusCode: 503, responseBody: '{"error":{"code":503,"status":"UNAVAILABLE"}}', isRetryable: true }))
  const r = await call('score', { contentType: 'podcast', clips: [{ key: 'a', text: 'hello', cues: [] }] })
  expect(r.status).toBe(429)
  expect(await r.json()).toMatchObject({ error: 'busy', retryAfter: 15 })
})
