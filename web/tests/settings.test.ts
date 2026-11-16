import { beforeEach, expect, test, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshDb } from './helpers'

let dir: string
beforeEach(() => { dir = freshDb(); vi.resetModules() })

test('defaults when unset', async () => {
  const { getSetting } = await import('@/lib/settings')
  expect(await getSetting('defaults')).toEqual({
    clipCount: 'auto', lengthRange: [30, 90], language: 'auto', tone: 'neutral', contentType: 'auto', whisperModel: 'large-v3-turbo', vocabulary: [], captionScript: 'native',
  })
  expect((await getSetting('brandKit')).position).toBe('br')
  expect(await getSetting('aiTasks')).toEqual({ highlight: null, scoring: null, titles: null, vision: null })
})

test('set then get roundtrips', async () => {
  const { getSetting, setSetting } = await import('@/lib/settings')
  await setSetting('defaults', { ...(await getSetting('defaults')), tone: 'funny', clipCount: 7 })
  expect((await getSetting('defaults')).tone).toBe('funny')
  expect((await getSetting('defaults')).clipCount).toBe(7)
})

test('invalid value throws', async () => {
  const { getSetting, setSetting } = await import('@/lib/settings')
  await expect(setSetting('defaults', { ...(await getSetting('defaults')), clipCount: 25 })).rejects.toThrow()
})

test('PUT unknown key → 404, bad body → 400', async () => {
  const { PUT } = await import('@/app/api/settings/[key]/route')
  const req = (b: unknown) => new Request('http://x', { method: 'PUT', body: JSON.stringify(b) })
  expect((await PUT(req({}), { params: Promise.resolve({ key: 'nope' }) })).status).toBe(404)
  expect((await PUT(req({ clipCount: 99 }), { params: Promise.resolve({ key: 'defaults' }) })).status).toBe(400)
})

test('files traversal → 404, real logo → 200 with CSP', async () => {
  writeFileSync(join(dir, 'logos', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const { GET } = await import('@/app/api/files/[...path]/route')
  const get = (path: string[]) => GET(new Request('http://x'), { params: Promise.resolve({ path }) })
  expect((await get(['logos', '..', 'clipforge.db'])).status).toBe(404)
  expect((await get(['logos', '..', '..', 'etc', 'passwd'])).status).toBe(404)
  expect((await get(['clipforge.db'])).status).toBe(404)
  const ok = await get(['logos', 'a.svg'])
  expect(ok.status).toBe(200)
  expect(ok.headers.get('content-type')).toBe('image/svg+xml')
  expect(ok.headers.get('content-security-policy')).toContain('sandbox')
})

test('logo upload rejects non-image, accepts png', async () => {
  const { POST } = await import('@/app/api/uploads/logo/route')
  const up = (bytes: Uint8Array<ArrayBuffer>, type: string, name: string) => {
    const fd = new FormData(); fd.append('file', new File([bytes], name, { type }))
    return POST(new Request('http://x', { method: 'POST', body: fd }))
  }
  expect((await up(new TextEncoder().encode('hello'), 'image/png', 'x.png')).status).toBe(400)
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
  const res = await up(png, 'image/png', 'logo.png')
  expect(res.status).toBe(200)
  expect((await res.json()).path).toMatch(/^logos\/[0-9a-f-]+\.png$/)
})
