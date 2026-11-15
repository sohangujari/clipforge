import { z } from 'zod'
import { isProviderKind, saveProvider } from '@/lib/providers-store'

const Body = z.object({ baseUrl: z.string().max(500).optional(), apiKey: z.string().max(500).optional(), enabled: z.boolean().optional() })

export async function PUT(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params
  if (!isProviderKind(kind)) return Response.json({ error: 'Unknown provider' }, { status: 404 })
  const body = Body.safeParse(await req.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'Invalid body', issues: body.error.issues }, { status: 400 })
  return Response.json(await saveProvider(kind, body.data))
}
