export const PROVIDER_KINDS = ['anthropic', 'openai', 'google', 'ollama', 'custom'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

export interface ProviderConfig { kind: ProviderKind; baseUrl?: string; apiKey?: string }
export interface ModelInfo { id: string; label: string; sizeBytes?: number; ramWarning?: boolean }

export const DEFAULT_BASE_URL: Partial<Record<ProviderKind, string>> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434',
}

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  anthropic: 'Anthropic (Claude)', openai: 'OpenAI', google: 'Google (Gemini)', ollama: 'Ollama (local)', custom: 'OpenAI-compatible',
}
