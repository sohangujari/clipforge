import { exportClips, Resolution } from '@/lib/exports'
import { handle } from '@/lib/projects'

/** POST { resolution } → { jobId }: every clip that isn't deleted, as one ZIP. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = Resolution.safeParse(await req.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'resolution must be 1080p or 720p' }, { status: 400 })
  const { id } = await ctx.params
  return handle(() => exportClips(id, 'all', body.data.resolution))
}
