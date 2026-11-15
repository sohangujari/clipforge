import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** All app data lives here. Next and the Prisma CLI both run with cwd = web/, so the default is <repo>/data. */
export function dataDir(): string {
  const dir = resolve(/*turbopackIgnore: true*/ process.env.CLIPFORGE_DATA_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), '..', 'data'))
  for (const sub of ['logos', 'fonts']) mkdirSync(join(/*turbopackIgnore: true*/ dir, sub), { recursive: true })
  return dir
}

export const dbFile = () => join(/*turbopackIgnore: true*/ dataDir(), 'clipforge.db')
