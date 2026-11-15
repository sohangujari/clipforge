import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Point CLIPFORGE_DATA_DIR at a fresh temp dir. */
export function freshDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clipforge-test-'))
  process.env.CLIPFORGE_DATA_DIR = dir
  return dir
}

import { execSync } from 'node:child_process'

/** Fresh data dir with the Prisma schema pushed. */
export function freshDb(): string {
  const dir = freshDataDir()
  execSync('npx prisma db push', { env: process.env, stdio: 'ignore' })
  return dir
}
