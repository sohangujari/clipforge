import { readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { dataDir } from '@/lib/paths'

const ROOTS = new Set(['logos', 'fonts'])
const TYPES: Record<string, string> = {
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

/** Serves only data/logos and data/fonts. SVGs can carry scripts, so everything gets a sandboxing CSP. */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const notFound = () => new Response('Not found', { status: 404 })
  if (!ROOTS.has(path[0])) return notFound()
  const root = join(/*turbopackIgnore: true*/ dataDir(), path[0])
  const file = resolve(/*turbopackIgnore: true*/ root, ...path.slice(1))
  if (!file.startsWith(root + sep)) return notFound()
  const type = TYPES[extname(file).toLowerCase()]
  try { if (!type || !statSync(file).isFile()) return notFound() } catch { return notFound() }
  return new Response(readFileSync(file), {
    headers: {
      'Content-Type': type,
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
