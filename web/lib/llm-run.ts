import 'server-only'
import { APICallError, generateText, NoObjectGeneratedError, Output } from 'ai'
import { z } from 'zod'
import { getModel } from './ai/providers'
import { mapProviderError } from './ai/errors'
import type { ProviderConfig, ProviderKind } from './ai/types'
import { countRequest } from './llm-usage'
import { LLM_TASKS, type LlmTaskName } from './llm-tasks'
import { loadProviderConfig } from './providers-store'
import { getSetting } from './settings'

export class LlmRunError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) { super(String(body.error)) }
}

type Slot = 'highlight' | 'scoring' | 'titles' | 'vision'
export interface Choice { provider: ProviderKind; model: string; cfg: ProviderConfig; local: boolean }

export function isLocal(cfg: ProviderConfig): boolean {
  if (cfg.kind === 'ollama') return true
  try { return cfg.kind === 'custom' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(cfg.baseUrl ?? '').hostname) } catch { return false }
}

export async function resolveChoice(slots: Slot[]): Promise<Choice | null> {
  const tasks = await getSetting('aiTasks')
  const c = slots.map((s) => tasks[s]).find(Boolean)
  if (!c) return null
  const cfg = await loadProviderConfig(c.provider)
  return { provider: c.provider, model: c.model, cfg, local: isLocal(cfg) }
}

/** Ollama's native API: lets us turn thinking off and fix the context size (its OpenAI endpoint can't). */
async function ollamaChat(c: Choice, system: string, prompt: string, schema: z.ZodType): Promise<unknown> {
  const base = (c.cfg.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '').replace(/\/v1$/, '')
  const body: Record<string, unknown> = {
    model: c.model, stream: false, think: false, format: z.toJSONSchema(schema),
    // keep_alive 0: measured on an 8 GB M3, Ollama's MLX runner held more memory after every request (3.9 → 5.7 GB),
    // swapping until a request timed out. Unloading after each request (~5 s reload) keeps it flat at ~3.9 GB.
    keep_alive: 0,
    options: { num_ctx: 4096, temperature: 0.2 }, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
  }
  const post = () => fetch(`${base}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) })
  let res = await post()
  if (res.status === 400 && /think/i.test(await res.clone().text())) { delete body.think; res = await post() } // model without a thinking mode
  if (!res.ok) throw new LlmRunError(502, { error: `Ollama: ${(await res.text()).slice(0, 200)}` })
  const data = await res.json()
  if (data?.done_reason === 'length') throw new LlmRunError(502, { error: 'Ollama: this part was too long for the model’s 4K context' })
  const content = data?.message?.content ?? ''
  try { return JSON.parse(content) } catch { throw new LlmRunError(502, { error: 'invalid_output', detail: content.slice(0, 200) }) }
}

function rateLimit(e: unknown): LlmRunError | null {
  if (!APICallError.isInstance(e)) return null
  if (e.statusCode === 503 || /high demand|overloaded/i.test(e.message)) {
    return new LlmRunError(429, { error: 'busy', retryAfter: 15 }) // temporary on the provider's side: wait and retry
  }
  if (e.statusCode !== 429) return null
  const body = e.responseBody ?? ''
  if (/insufficient_quota/.test(body)) {
    return new LlmRunError(429, { error: 'quota', message: 'Your OpenAI account is out of credit — add credit in OpenAI billing, or switch models in Settings → AI.' })
  }
  if (/PerDay|per day|daily/i.test(body)) {
    return new LlmRunError(429, { error: 'quota', message: 'Daily free quota reached for this model — it resets at midnight Pacific. Switch models in Settings → AI to continue.' })
  }
  const header = Number(e.responseHeaders?.['retry-after'])
  const delay = Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1])
  return new LlmRunError(429, { error: 'rate_limited', retryAfter: Math.ceil(header || delay || 30) })
}

/** The outermost {...} in a reply wrapped in ```json fences or chatter (seen with gpt-oss and Gemma on Cloudflare). */
function extractJson(text?: string): unknown {
  const a = text?.indexOf('{') ?? -1, b = text?.lastIndexOf('}') ?? -1
  if (a < 0 || b <= a) return undefined
  try { return JSON.parse(text!.slice(a, b + 1)) } catch { return undefined }
}

/** Runs a structured LLM task with the user's chosen model. Throws LlmRunError(status, body). */
export async function runTask(name: LlmTaskName, rawInput: unknown): Promise<{ output: unknown; local: boolean }> {
  const t = LLM_TASKS[name]
  const input = t.input.safeParse(rawInput)
  if (!input.success) throw new LlmRunError(400, { error: 'invalid input', issues: input.error.issues })
  const choice = await resolveChoice(t.slots)
  if (!choice) throw new LlmRunError(424, { error: 'no_model' })
  let system = t.system(input.data as never)
  const prompt = t.prompt(input.data as never)
  const compat = choice.provider === 'custom' || choice.provider === 'cloudflare'
  if (compat) { // many OpenAI-compatible models ignore response_format
    system += `\n\nReply with only a JSON object that matches this JSON schema:\n${JSON.stringify(z.toJSONSchema(t.output))}`
  }
  await countRequest(choice.provider, choice.model)
  let raw: unknown
  try {
    if (choice.provider === 'ollama') raw = await ollamaChat(choice, system, prompt, t.output)
    else raw = (await generateText({ model: getModel(choice.cfg, choice.model), system, prompt, output: Output.object({ schema: t.output }), maxRetries: 0,
      ...(compat && { maxOutputTokens: 16_000 }), // Cloudflare's small default ran out mid-reasoning → empty answer
      providerOptions: { openai: { strictJsonSchema: false },
        // Thinking off for the easy tasks: Gemma on Cloudflare scored in 2 s instead of 24 s. Highlights keep it (the judgment call).
        ...(choice.provider === 'cloudflare' && name !== 'highlights' && name !== 'search' && { cloudflare: { chat_template_kwargs: { enable_thinking: false } } }) },
      abortSignal: AbortSignal.timeout(300_000) })).output // strict mode rejects optional fields and records → 0 clips
  } catch (e) {
    if (e instanceof LlmRunError) throw e
    const recovered = NoObjectGeneratedError.isInstance(e) ? extractJson(e.text) : undefined
    if (recovered !== undefined) raw = recovered
    else throw rateLimit(e) ?? new LlmRunError(502, { error: mapProviderError(e, choice.provider, choice.cfg.baseUrl).userMessage })
  }
  const out = t.output.safeParse(raw)
  if (!out.success) throw new LlmRunError(502, { error: 'invalid_output' })
  return { output: out.data, local: choice.local }
}

export async function unloadLocal(): Promise<boolean> {
  const c = await resolveChoice(['highlight'])
  if (!c || c.provider !== 'ollama') return false
  const base = (c.cfg.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '').replace(/\/v1$/, '')
  await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify({ model: c.model, keep_alive: 0 }) }).catch(() => {})
  return true
}
