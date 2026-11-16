import { handle, ProjectSettingsSchema } from '@/lib/projects'
import { completeUpload } from '@/lib/uploads'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const b = (await req.json().catch(() => ({}))) as { settings?: unknown; contentType?: string }
  return handle(async () => completeUpload(id, ProjectSettingsSchema.parse(b.settings ?? {}), b.contentType), 201)
}
