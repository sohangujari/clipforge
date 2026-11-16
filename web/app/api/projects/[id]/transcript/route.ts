import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '@/lib/paths'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 })
  try {
    return new Response(readFileSync(join(/*turbopackIgnore: true*/ dataDir(), 'media', id, 'transcript.json')), { headers: { 'Content-Type': 'application/json' } })
  } catch {
    return Response.json({ error: 'No transcript yet' }, { status: 404 })
  }
}
