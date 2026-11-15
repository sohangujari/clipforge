import { totalmem } from 'node:os'
import { generateText, type LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { HttpError, mapProviderError, ProviderError, type ProviderErrorCode } from './errors'
import { DEFAULT_BASE_URL, type ModelInfo, type ProviderConfig } from './types'

const OLLAMA_WARN_BYTES = 4e9
const trim = (u: string) => u.replace(/\/+$/, '')
const base = (cfg: ProviderConfig) => {
  const u = trim(cfg.baseUrl || DEFAULT_BASE_URL[cfg.kind] || '')
  return cfg.kind === 'ollama' ? u.replace(/\/v1$/, '') : u // people paste Ollama's OpenAI-compatible URL
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''))
  try { return await res.json() } catch { throw new HttpError(404, 'not json') } // e.g. an HTML page: wrong base URL

}

const bearer = (k?: string): Record<string, string> => (k ? { Authorization: `Bearer ${k}` } : {})

export async function listModels(cfg: ProviderConfig, opts: { totalMem?: number; timeoutMs?: number } = {}): Promise<ModelInfo[]> {
  const t = opts.timeoutMs ?? 5000
  try {
    switch (cfg.kind) {
      case 'anthropic': {
        const j = await getJson('https://api.anthropic.com/v1/models?limit=1000', { 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2023-06-01' }, t)
        return j.data.map((m: { id: string; display_name?: string }) => ({ id: m.id, label: m.display_name ?? m.id }))
      }
      case 'google': {
        const j = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': cfg.apiKey ?? '' }, t)
        return j.models
          .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: { name: string; displayName?: string }) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName ?? m.name }))
      }
      case 'ollama': {
        const mem = opts.totalMem ?? totalmem()
        const j = await getJson(`${base(cfg)}/api/tags`, {}, t)
        return j.models.map((m: { name: string; size: number }) => ({
          id: m.name, label: m.name, sizeBytes: m.size, ramWarning: m.size > OLLAMA_WARN_BYTES && mem <= 8 * 2 ** 30,
        }))
      }
      case 'openai':
      case 'custom': {
        const j = await getJson(`${base(cfg)}/models`, bearer(cfg.apiKey), t)
        return j.data.map((m: { id: string }) => ({ id: m.id, label: m.id }))
      }
    }
  } catch (e) {
    // On a models endpoint, 404 (or a non-JSON page) means the base URL is wrong, not that a model is missing.
    if (e instanceof HttpError && e.status === 404) {
      throw new ProviderError('unreachable', cfg.kind === 'ollama'
        ? `Ollama isn't answering at ${base(cfg)} — check the base URL (default http://localhost:11434)`
        : `No API found at ${base(cfg)} — check the base URL`)
    }
    throw mapProviderError(e, cfg.kind, base(cfg) || undefined)
  }
}

export function getModel(cfg: ProviderConfig, modelId: string): LanguageModel {
  switch (cfg.kind) {
    case 'anthropic': return createAnthropic({ apiKey: cfg.apiKey })(modelId)
    case 'openai': return createOpenAI({ apiKey: cfg.apiKey, baseURL: base(cfg) })(modelId)
    case 'google': return createGoogleGenerativeAI({ apiKey: cfg.apiKey })(modelId)
    case 'ollama': return createOpenAICompatible({ name: 'ollama', baseURL: `${base(cfg)}/v1` })(modelId)
    case 'custom': return createOpenAICompatible({ name: 'custom', baseURL: base(cfg), apiKey: cfg.apiKey })(modelId)
  }
}

export type TestResult = { ok: true; modelCount: number } | { ok: false; error: { code: ProviderErrorCode; message: string } }

/** timeoutMs bounds the optional model call: a cold local model on 8GB can take a while, but must never spin forever. */
export async function testConnection(cfg: ProviderConfig, modelId?: string, opts: { timeoutMs?: number } = {}): Promise<TestResult> {
  try {
    const models = await listModels(cfg)
    if (modelId) {
      await generateText({ model: getModel(cfg, modelId), prompt: 'ping', maxOutputTokens: 1, maxRetries: 0, abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) })
    }
    return { ok: true, modelCount: models.length }
  } catch (e) {
    const pe = mapProviderError(e, cfg.kind, base(cfg) || undefined)
    return { ok: false, error: { code: pe.code, message: pe.userMessage } }
  }
}
