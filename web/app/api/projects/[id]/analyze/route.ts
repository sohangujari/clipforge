import { analyzeProject, handle } from '@/lib/projects'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handle(() => analyzeProject(id))
}
