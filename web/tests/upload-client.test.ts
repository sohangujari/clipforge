import { afterEach, expect, test, vi } from 'vitest'
import { uploadFile } from '@/lib/upload-client'

afterEach(() => vi.unstubAllGlobals())

/** In-memory fake of the upload API that fails the 2nd PATCH once (network drop). */
function fakeServer(size: number) {
  let received = 0, patches = 0
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'POST' && url === '/api/uploads') return Response.json({ uploadId: 'u1', offset: received })
    if (method === 'GET') return Response.json({ offset: received, size })
    if (method === 'PATCH') {
      patches++
      if (patches === 2) throw new TypeError('network down')
      const off = Number(new URL(url, 'http://x').searchParams.get('offset'))
      if (off !== received) return Response.json({ offset: received }, { status: 409 })
      received += (init!.body as Blob).size
      return Response.json({ offset: received })
    }
    throw new Error(`unexpected ${method} ${url}`)
  })
  return { fetchFn, get received() { return received } }
}

test('uploads in chunks, survives a network drop, reports progress to 1', async () => {
  const size = 20 * 1024 * 1024 + 5 // 3 chunks of 8 MiB
  const srv = fakeServer(size)
  vi.stubGlobal('fetch', srv.fetchFn)
  const progress: number[] = []
  const file = new File([new Uint8Array(size)], 'big.mp4', { lastModified: 1 })
  const id = await uploadFile(file, { onProgress: (p) => progress.push(p), retryDelayMs: 1 })
  expect(id).toBe('u1')
  expect(srv.received).toBe(size)
  expect(progress.at(-1)).toBe(1)
})

test('gives up after 3 retries with a readable error', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ uploadId: 'u1', offset: 0 })
    if (!init?.method) return Response.json({ offset: 0, size: 10 })
    throw new TypeError('network down')
  }))
  const file = new File([new Uint8Array(10)], 'a.mp4')
  await expect(uploadFile(file, { onProgress: () => {}, retryDelayMs: 1 })).rejects.toThrow(/Upload interrupted/)
})
