import { LLM_TASKS, type LlmTaskName } from '@/lib/llm-tasks'
import { LlmRunError, resolveChoice, runTask, unloadLocal } from '@/lib/llm-run'
import { checkWorkerToken } from '@/lib/worker-token'

const json = (body: unknown, status = 200, local = false) =>
  Response.json(body, { status, headers: local ? { 'X-ClipForge-Local': '1' } : {} })

/** The worker's only way to reach the user's AI model, so there's one provider layer. Loopback + token only. */
export async function POST(req: Request) {
  if (!checkWorkerToken(req.headers.get('x-clipforge-token'))) return json({ error: 'unauthorized' }, 401)
  const body = (await req.json().catch(() => ({}))) as { task?: string; input?: unknown }
  if (body.task === 'info') {
    const c = await resolveChoice(['highlight'])
    return json({ output: c ? { local: c.local, provider: c.provider, model: c.model } : { local: false, provider: null, model: null } }, 200, !!c?.local)
  }
  if (body.task === 'unload') return json({ output: { unloaded: await unloadLocal() } })
  if (!(body.task && body.task in LLM_TASKS)) return json({ error: 'unknown task' }, 400)
  try {
    const { output, local } = await runTask(body.task as LlmTaskName, body.input)
    return json({ output }, 200, local)
  } catch (e) {
    if (e instanceof LlmRunError) return json(e.body, e.status)
    throw e
  }
}
