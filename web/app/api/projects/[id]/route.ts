import { deleteProject, getProject, handle, ProjectError, setSpeakers } from '@/lib/projects'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return handle(async () => (await getProject(id)) ?? Promise.reject(new ProjectError(404, 'Project not found')))
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return handle(() => deleteProject(id))
}

/** { speakers: [{ name, color }] } */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const json = await req.json().catch(() => null)
  return handle(() => setSpeakers(id, json?.speakers))
}
