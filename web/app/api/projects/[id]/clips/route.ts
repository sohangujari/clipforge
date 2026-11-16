import { listClips, tasteCount } from '@/lib/clip-views'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return Response.json({ clips: await listClips(id), tasteCount: await tasteCount() })
}
