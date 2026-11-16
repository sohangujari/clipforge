import { z } from 'zod'
import { getClip, setClipEdit, setClipStatus } from '@/lib/clip-views'
import { ClipEditSchema } from '@/lib/clip-edit'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const c = await getClip((await ctx.params).id)
  return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
}

/** { status: 'kept' | 'deleted' } or { edit: ClipEdit } */
export async function PATCH(req: Request, ctx: Ctx) {
  const json = await req.json().catch(() => null)
  const id = (await ctx.params).id
  if (json && 'edit' in json) {
    const edit = ClipEditSchema.safeParse(json.edit)
    if (!edit.success) return Response.json({ error: 'Invalid edit', issues: edit.error.issues }, { status: 400 })
    const c = await setClipEdit(id, edit.data)
    return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
  }
  const body = z.object({ status: z.enum(['kept', 'deleted']) }).safeParse(json)
  if (!body.success) return Response.json({ error: 'status must be kept or deleted' }, { status: 400 })
  const c = await setClipStatus(id, body.data.status)
  return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
}
