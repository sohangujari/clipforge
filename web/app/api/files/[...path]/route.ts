import { createReadStream, openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extname, join, resolve, sep } from 'node:path'
import { attachment, safeFilename } from '@/lib/filenames'
import { dataDir } from '@/lib/paths'

const ROOTS = new Set(['logos', 'fonts', 'media', 'renders', 'bumpers'])
const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.json': 'application/json', '.zip': 'application/zip', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
}
// media/ also holds source videos, audio and transcripts — only these are served:
const MEDIA_ALLOWED = [/^[0-9a-f-]{36}\/(thumb\.jpg|proxy\.mp4|track\.json|people\.json)$/, /^[0-9a-f-]{36}\/clips\/[0-9a-f-]{36}\.jpg$/]
// renders/ holds exports (and FFmpeg's working files) — only finished MP4s and ZIPs are served:
const RENDERS_ALLOWED = [/^[0-9a-f-]{36}-(1080p|720p)\.mp4$/, /^[0-9a-f-]{36}-clips\.zip$/]
const MAX_RANGE = 1024 * 1024 // small pieces: hover previews get cancelled a lot; browsers fetch the next range as needed

/** Serves logos, fonts and allow-listed media. SVGs can carry scripts, so everything gets a sandboxing CSP. Video supports Range. */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const notFound = () => new Response('Not found', { status: 404 })
  if (!ROOTS.has(path[0])) return notFound()
  if (path[0] === 'media' && !MEDIA_ALLOWED.some((re) => re.test(path.slice(1).join('/')))) return notFound()
  if (path[0] === 'renders' && !RENDERS_ALLOWED.some((re) => re.test(path.slice(1).join('/')))) return notFound()
  const root = join(/*turbopackIgnore: true*/ dataDir(), path[0])
  const file = resolve(/*turbopackIgnore: true*/ root, ...path.slice(1))
  if (!file.startsWith(root + sep)) return notFound()
  const type = TYPES[extname(file).toLowerCase()]
  let size: number
  try { const st = statSync(file); if (!type || !st.isFile()) return notFound(); size = st.size } catch { return notFound() }
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  }
  if (path[0] === 'renders') { // downloads: streamed (a ZIP can be hundreds of MB) and named after the clip
    const name = safeFilename(new URL(req.url).searchParams.get('name') ?? 'clip', extname(file).slice(1))
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream,
      { headers: { ...headers, 'Content-Length': String(size), 'Content-Disposition': attachment(name), 'Cache-Control': 'no-store' } })
  }
  if (!type.startsWith('video/')) return new Response(readFileSync(file), { headers })

  headers['Accept-Ranges'] = 'bytes'
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
  if (!m) return new Response(readFileSync(file), { headers: { ...headers, 'Content-Length': String(size) } })
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
  const end = Math.min(m[1] && m[2] ? Number(m[2]) : start + MAX_RANGE - 1, size - 1, start + MAX_RANGE - 1)
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  const buf = Buffer.alloc(end - start + 1)
  const fd = openSync(file, 'r')
  try { readSync(fd, buf, 0, buf.length, start) } finally { closeSync(fd) }
  return new Response(buf, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(buf.length) } })
}
