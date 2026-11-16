import 'server-only'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'

/** Shared secret between Next and the local worker (data/.worker-token, 0600). */
export function getWorkerToken(): string {
  const file = join(/*turbopackIgnore: true*/ dataDir(), '.worker-token')
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim()
    if (t) return t
  }
  try {
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }) // exclusive: the worker may create it first
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  return readFileSync(file, 'utf8').trim()
}

export function checkWorkerToken(given: string | null): boolean {
  if (!given) return false
  const a = Buffer.from(given), b = Buffer.from(getWorkerToken())
  return a.length === b.length && timingSafeEqual(a, b)
}
