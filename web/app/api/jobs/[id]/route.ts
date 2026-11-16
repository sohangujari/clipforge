import { connection } from 'next/server'
import { jobStatus } from '@/lib/exports'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  const s = await jobStatus((await ctx.params).id)
  return s ? Response.json(s) : Response.json({ error: 'Job not found' }, { status: 404 })
}
