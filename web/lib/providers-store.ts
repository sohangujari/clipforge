import 'server-only'
import { getDb } from './db'
import { decrypt, encrypt, SecretError } from './secret'
import { DEFAULT_BASE_URL, PROVIDER_KINDS, type ProviderConfig, type ProviderKind } from './ai/types'

export interface ProviderView { kind: ProviderKind; baseUrl?: string; enabled: boolean; keyHint?: string; needsKey: boolean }

const KEYLESS: ProviderKind[] = ['ollama', 'custom']
export const isProviderKind = (k: string): k is ProviderKind => (PROVIDER_KINDS as readonly string[]).includes(k)

function tryDecrypt(blob?: string | null): string | undefined {
  if (!blob) return undefined
  try { return decrypt(blob) } catch (e) { if (e instanceof SecretError) return undefined; throw e }
}

function toView(kind: ProviderKind, row?: { baseUrl: string | null; apiKeyEnc: string | null; enabled: boolean } | null): ProviderView {
  const key = tryDecrypt(row?.apiKeyEnc)
  return {
    kind,
    baseUrl: row?.baseUrl ?? DEFAULT_BASE_URL[kind],
    enabled: row?.enabled ?? kind === 'ollama',
    keyHint: key ? `••••${key.slice(-4)}` : undefined,
    needsKey: !key && !KEYLESS.includes(kind),
  }
}

export async function listProviderViews(): Promise<ProviderView[]> {
  const rows = await getDb().provider.findMany()
  return PROVIDER_KINDS.map((k) => toView(k, rows.find((r) => r.kind === k)))
}

/** Blank or missing apiKey keeps the stored key. Keys are trimmed. */
export async function saveProvider(kind: ProviderKind, input: { baseUrl?: string; apiKey?: string; enabled?: boolean }): Promise<ProviderView> {
  const key = input.apiKey?.trim()
  const data = {
    ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl.trim() || null }),
    ...(input.enabled !== undefined && { enabled: input.enabled }),
    ...(key && { apiKeyEnc: encrypt(key) }),
  }
  const row = await getDb().provider.upsert({ where: { kind }, create: { kind, ...data }, update: data })
  return toView(kind, row)
}

export async function loadProviderConfig(kind: ProviderKind): Promise<ProviderConfig> {
  const row = await getDb().provider.findUnique({ where: { kind } })
  return { kind, baseUrl: row?.baseUrl ?? DEFAULT_BASE_URL[kind], apiKey: tryDecrypt(row?.apiKeyEnc) }
}
