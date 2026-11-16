import { z } from 'zod'
import { getClip } from '@/lib/clip-views'
import { getDb } from '@/lib/db'
import { LLM_TASKS } from '@/lib/llm-tasks'
import { LlmRunError, resolveChoice, runTask } from '@/lib/llm-run'

const Body = z.object({ field: z.enum(['titles', 'descriptions', 'hashtags']) })
const COLUMN = { titles: 'titles', descriptions: 'descriptions', hashtags: 'hashtags' } as const

/** Regenerate one text field of a clip with the user's model. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = Body.safeParse(await req.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'field must be titles, descriptions or hashtags' }, { status: 400 })
  const clip = await getClip((await ctx.params).id)
  if (!clip) return Response.json({ error: 'Clip not found' }, { status: 404 })
  const db = getDb()
  // 8 GB rule: a local model must not load while the worker is transcribing or finding clips.
  const choice = await resolveChoice(LLM_TASKS.metadata.slots)
  if (choice?.local && (await db.job.count({ where: { status: { in: ['running', 'cancel_requested'] } } }))) {
    return Response.json({ error: 'Your local model is busy while a video is processing — try again when it finishes' }, { status: 423 })
  }
  const project = await db.project.findUniqueOrThrow({ where: { id: clip.projectId } })
  const settings = JSON.parse(project.settings)
  try {
    const { output } = await runTask('metadata', {
      contentType: project.contentType === 'auto' ? 'custom' : project.contentType, tone: settings.tone ?? 'neutral', language: project.language ?? 'en',
      clips: [{ key: '0', text: clip.transcript.map((w) => w.w).join(' ') || clip.titles[0] }],
    })
    const item = (output as { items: Record<string, unknown>[] }).items[0]
    if (!item) return Response.json({ error: 'The model returned nothing — try again' }, { status: 502 })
    const f = body.data.field
    await db.clip.update({ where: { id: clip.id }, data: { [COLUMN[f]]: JSON.stringify(item[f]) } })
    return Response.json(await getClip(clip.id))
  } catch (e) {
    if (e instanceof LlmRunError) {
      const msg = e.status === 424 ? 'Set a model in Settings → AI first' : e.status === 429 && e.body.error === 'rate_limited'
        ? `Rate limited — try again in ${e.body.retryAfter}s` : String(e.body.message ?? e.body.error)
      return Response.json({ error: msg }, { status: e.status })
    }
    throw e
  }
}
