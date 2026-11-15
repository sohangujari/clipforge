import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'

export class SecretError extends Error {}

/**
 * 32-byte key in data/.secret (chmod 600). Read on every call (tiny file) so a deleted or replaced
 * key is noticed immediately; a missing or malformed key is regenerated, which makes old keys show as needing re-entry.
 * Guards keys at rest, not against someone with access to this account.
 */
function getKey(): Buffer {
  const file = join(/*turbopackIgnore: true*/ dataDir(), '.secret')
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
    if (key.length === 32) return key
  }
  const key = randomBytes(32)
  writeFileSync(file, key.toString('base64'), { mode: 0o600 })
  chmodSync(file, 0o600)
  return key
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', getKey(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(/*turbopackIgnore: true*/ ':')
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new SecretError('Malformed secret')
  try {
    const d = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
  } catch {
    throw new SecretError('Secret could not be decrypted (key changed?)')
  }
}
