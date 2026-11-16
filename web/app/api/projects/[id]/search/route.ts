import { handle, searchProject } from '@/lib/projects'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const { query } = (await req.json().catch(() => ({}))) as { query?: unknown }
  return handle(() => searchProject(id, typeof query === 'string' ? query : ''))
}
