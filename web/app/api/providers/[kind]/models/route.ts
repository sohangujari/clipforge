import { isProviderKind, loadProviderConfig } from '@/lib/providers-store'
import { listModels } from '@/lib/ai/providers'
import { mapProviderError } from '@/lib/ai/errors'

/** Provider errors are returned as data (200) so the UI can show them inline. */
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params
  if (!isProviderKind(kind)) return Response.json({ error: 'Unknown provider' }, { status: 404 })
  const cfg = await loadProviderConfig(kind)
  try {
    return Response.json({ models: await listModels(cfg) })
  } catch (e) {
    const pe = mapProviderError(e, kind, cfg.baseUrl)
    return Response.json({ error: { code: pe.code, message: pe.userMessage } })
  }
}
