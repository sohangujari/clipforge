// Test-only OpenAI-compatible model for Playwright. Picks the task from the system prompt and returns schema-valid JSON.
import { createServer } from 'node:http'

const PORT = Number(process.env.FAKE_LLM_PORT || 3199)
let metaCount = 0

const ids = (prompt) => [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]))
const keys = (prompt) => [...prompt.matchAll(/^Clip (\S+?)(?: \(|:)/gm)].map((m) => m[1])

function answer(system, prompt) {
  if (/expert short-form video editor/.test(system)) {
    const s = ids(prompt)
    if (!s.length) return { candidates: [] }
    const third = Math.max(1, Math.floor(s.length / 3))
    const c = [0, 1, 2].map((k) => ({ startId: s[Math.min(k * third, s.length - 1)], endId: s[Math.min(k * third + third - 1, s.length - 1)],
      hookId: s[Math.min(k * third, s.length - 1)], why: `Moment ${k + 1}`, kind: 'story' }))
    return /decide the content type/.test(system) ? { contentType: 'podcast', candidates: c } : { candidates: c }
  }
  if (/rate short-form clips/.test(system)) {
    return { scores: keys(prompt).map((key, i) => ({ key, hook: 85 - i * 5, emotion: 70, value: 72, pacing: 75, trend: 50, extra: {},
      reasons: { hook: 'Opens strong with a question', emotion: 'Warm', value: 'Useful', pacing: 'Tight', trend: 'Evergreen' },
      summary: 'Clear story with a payoff', tips: ['Start one sentence later'] })) }
  }
  if (/packaging for short-form clips/.test(system)) {
    metaCount++
    return { items: keys(prompt).map((key) => ({ key, titles: [`Title ${key} v${metaCount}`, `Alt ${key}`, `Third ${key}`],
      descriptions: { shorts: 'Shorts text', tiktok: 'TikTok text 🔥', reels: 'Reels text' }, hashtags: ['#a', '#b', '#c', '#d', '#e'] })) }
  }
  if (/Find the moments in this transcript that match/.test(system)) {
    if (/dinosaur/i.test(system)) return { matches: [] }
    const s = ids(prompt)
    return { matches: s.length ? [{ startId: s[0], endId: s[Math.min(s.length - 1, 3)], hookId: s[0], why: 'Matches the request' }] : [] }
  }
  return {}
}

createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake', object: 'model' }] }))
    if (req.url?.endsWith('/chat/completions')) {
      const { messages = [] } = JSON.parse(body || '{}')
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
      const prompt = messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text).join(''))).join('\n')
      const content = JSON.stringify(answer(system, prompt))
      return res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'fake',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    }
    res.statusCode = 404; res.end('{}')
  })
}).listen(PORT, '127.0.0.1', () => console.log(`fake llm ready on ${PORT}`))
