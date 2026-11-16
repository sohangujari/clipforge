import { expect, test } from 'vitest'
import { proxy } from '@/proxy'

const req = (method: string, path: string, headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:3000${path}`, { method, headers: { host: '127.0.0.1:3000', ...headers } })

test('blocks cross-site writes to the API', () => {
  expect(proxy(req('POST', '/api/projects', { 'sec-fetch-site': 'cross-site' }))?.status).toBe(403)
  expect(proxy(req('DELETE', '/api/projects/x', { origin: 'https://evil.example' }))?.status).toBe(403)
  expect(proxy(req('PATCH', '/api/uploads/x', { 'sec-fetch-site': 'same-site', origin: 'http://localhost:4000' }))?.status).toBe(403)
})

test('allows same-origin browser writes, non-browser clients and all reads', () => {
  expect(proxy(req('POST', '/api/projects', { 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3000' }))).toBeUndefined()
  expect(proxy(req('POST', '/api/projects'))).toBeUndefined() // curl / scripts send no browser headers
  expect(proxy(req('GET', '/api/projects', { 'sec-fetch-site': 'cross-site' }))).toBeUndefined()
})

test('the token-guarded worker route is left to its own check', () => {
  expect(proxy(req('POST', '/api/internal/llm', { 'sec-fetch-site': 'cross-site' }))).toBeUndefined()
})
