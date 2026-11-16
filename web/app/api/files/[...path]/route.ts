import { openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { dataDir } from '@/lib/paths'

const ROOTS = new Set(['logos', 'fonts', 'media'])
const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
}
// media/ also holds source videos, audio and transcripts — only these are served:
const MEDIA_ALLOWED = [/^[0-9a-f-]{36}\/(thumb\.jpg|proxy\.mp4)$/, /^[0-9a-f-]{36}\/clips\/[0-9a-f-]{36}\.jpg$/]
const MAX_RANGE = 1024 * 1024 // small pieces: hover previews get cancelled a lot; browsers fetch the next range as needed

/** Serves logos, fonts and allow-listed media. SVGs can carry scripts, so everything gets a sandboxing CSP. Video supports Range. */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const notFound = () => new Response('Not found', { status: 404 })
  if (!ROOTS.has(path[0])) return notFound()
  if (path[0] === 'media' && !MEDIA_ALLOWED.some((re) => re.test(path.slice(1).join('/')))) return notFound()
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
  if (type !== 'video/mp4') return new Response(readFileSync(file), { headers })

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
