import { z } from 'zod'
import { getClip, setClipStatus } from '@/lib/clip-views'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const c = await getClip((await ctx.params).id)
  return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
}

export async function PATCH(req: Request, ctx: Ctx) {
  const body = z.object({ status: z.enum(['kept', 'deleted']) }).safeParse(await req.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'status must be kept or deleted' }, { status: 400 })
  const c = await setClipStatus((await ctx.params).id, body.data.status)
  return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
}
