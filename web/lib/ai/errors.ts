import type { ProviderKind } from './types'

export type ProviderErrorCode = 'invalid_key' | 'model_not_found' | 'rate_limited' | 'unreachable' | 'unknown'

export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, public userMessage: string) { super(userMessage) }
}

/** Thrown by our own fetch wrapper for non-2xx responses. */
export class HttpError extends Error {
  constructor(public status: number, public body: string) { super(`HTTP ${status}`) }
}

export function mapProviderError(e: unknown, kind: ProviderKind, baseUrl?: string): ProviderError {
  if (e instanceof ProviderError) return e
  const status = e instanceof HttpError ? e.status : (e as { statusCode?: number })?.statusCode
  if (status === 401 || status === 403) return new ProviderError('invalid_key', 'API key was rejected — check it and try again')
  if (status === 404) return new ProviderError('model_not_found', 'Model not found on this provider')
  if (status === 429) return new ProviderError('rate_limited', 'Rate limited — wait a moment and retry')
  const name = (e as Error)?.name, cause = (e as { cause?: { code?: string } })?.cause?.code
  if (name === 'TimeoutError' || (e as { cause?: { name?: string } })?.cause?.name === 'TimeoutError') {
    return new ProviderError('unreachable', kind === 'ollama' ? 'Ollama took too long — the model may be too big for this Mac, or still loading' : 'The provider took too long to answer')
  }
  if (e instanceof TypeError || name === 'AbortError' || cause === 'ECONNREFUSED') {
    return kind === 'ollama'
      ? new ProviderError('unreachable', "Ollama isn't running — start it with `ollama serve`")
      : new ProviderError('unreachable', `Can't reach ${baseUrl ?? 'the provider'}`)
  }
  return new ProviderError('unknown', (e as Error)?.message || 'Unknown provider error')
}
