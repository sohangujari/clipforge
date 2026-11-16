import { deleteProject, getProject, handle, ProjectError } from '@/lib/projects'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return handle(async () => (await getProject(id)) ?? Promise.reject(new ProjectError(404, 'Project not found')))
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return handle(() => deleteProject(id))
}
