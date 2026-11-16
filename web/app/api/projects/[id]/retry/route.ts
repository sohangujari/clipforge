import { handle, retryProject } from '@/lib/projects'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handle(() => retryProject(id))
}
