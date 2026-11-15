import { isProviderKind, loadProviderConfig } from '@/lib/providers-store'
import { testConnection } from '@/lib/ai/providers'

export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params
  if (!isProviderKind(kind)) return Response.json({ error: 'Unknown provider' }, { status: 404 })
  const { modelId } = (await req.json().catch(() => ({}))) as { modelId?: string }
  return Response.json(await testConnection(await loadProviderConfig(kind), typeof modelId === 'string' ? modelId : undefined))
}
