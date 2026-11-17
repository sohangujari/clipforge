import { z } from 'zod'
import { getClip, setClipEdit, setClipStatus, setClipViews } from '@/lib/clip-views'
import { ClipEditSchema } from '@/lib/clip-edit'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const c = await getClip((await ctx.params).id)
  return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
}

/** { status: 'kept' | 'deleted' }, { edit: ClipEdit } or { views: number | null } */
export async function PATCH(req: Request, ctx: Ctx) {
  const json = await req.json().catch(() => null)
  const id = (await ctx.params).id
  if (json && 'edit' in json) {
    const edit = ClipEditSchema.safeParse(json.edit)
    if (!edit.success) return Response.json({ error: 'Invalid edit', issues: edit.error.issues }, { status: 400 })
    const c = await setClipEdit(id, edit.data)
    return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
  }
  if (json && 'views' in json) {
    const v = z.number().int().min(0).max(1e11).nullable().safeParse(json.views)
    if (!v.success) return Response.json({ error: 'views must be a whole number' }, { status: 400 })
    const c = await setClipViews(id, v.data)
    return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
  }
  const body = z.object({ status: z.enum(['kept', 'deleted']) }).safeParse(json)
  if (!body.success) return Response.json({ error: 'status must be kept or deleted' }, { status: 400 })
  const c = await setClipStatus(id, body.data.status)
  return c ? Response.json(c) : Response.json({ error: 'Clip not found' }, { status: 404 })
}
