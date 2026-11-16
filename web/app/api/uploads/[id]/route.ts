import { handle, ProjectError } from '@/lib/projects'
import { appendChunk, uploadOffset } from '@/lib/uploads'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return handle(async () => uploadOffset(id))
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const offset = Number(new URL(req.url).searchParams.get('offset'))
  try {
    return Response.json(await appendChunk(id, offset, req.body))
  } catch (e) {
    if (e instanceof ProjectError && e.status === 409) return Response.json({ error: e.message, offset: (e as ProjectError & { offset: number }).offset }, { status: 409 })
    return handle(() => Promise.reject(e))
  }
}
