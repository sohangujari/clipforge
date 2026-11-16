// Browser-side resumable uploader for /api/uploads.
const CHUNK = 8 * 1024 * 1024
const RETRIES = 3

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 409) throw new Error(body.error ?? `Upload failed (${res.status})`)
  return body
}

/** Uploads `file` in 8 MiB chunks, resuming from the server's offset after errors or a page reload. Returns the uploadId. */
export async function uploadFile(file: File, opts: { onProgress: (p: number) => void; signal?: AbortSignal; retryDelayMs?: number }): Promise<string> {
  const delay = opts.retryDelayMs ?? 1000
  const init = await jsonOrThrow(await fetch('/api/uploads', {
    method: 'POST', signal: opts.signal, body: JSON.stringify({ name: file.name, size: file.size, lastModified: file.lastModified }),
  }))
  const id: string = init.uploadId
  let offset: number = init.offset
  let failures = 0
  opts.onProgress(offset / file.size)
  while (offset < file.size) {
    try {
      const res = await fetch(`/api/uploads/${id}?offset=${offset}`, { method: 'PATCH', signal: opts.signal, body: file.slice(offset, offset + CHUNK) })
      offset = (await jsonOrThrow(res)).offset // 409 also carries the server's offset
      failures = 0
      opts.onProgress(offset / file.size)
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof Error && !(e instanceof TypeError) && !/fetch/i.test(e.message))) throw e
      if (++failures > RETRIES) throw new Error('Upload interrupted — check your connection and choose the file again to resume')
      await new Promise((r) => setTimeout(r, delay * 2 ** (failures - 1)))
      offset = await fetch(`/api/uploads/${id}`, { signal: opts.signal }).then(jsonOrThrow).then((b) => b.offset as number).catch(() => offset)
    }
  }
  return id
}
