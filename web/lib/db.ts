import 'server-only'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './generated/prisma/client'
import { dbFile } from './paths'

function create() {
  const file = dbFile()
  // WAL persists in the file; lets the Python worker (Phase 2) read while Next writes.
  const raw = new Database(file); raw.pragma('journal_mode = WAL'); raw.close()
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) })
}

const g = globalThis as unknown as { __cfDb?: { file: string; client: PrismaClient } }

/** One client per DB file (survives Next dev hot reload; tests switch CLIPFORGE_DATA_DIR). */
export function getDb(): PrismaClient {
  const file = dbFile()
  if (g.__cfDb?.file !== file) g.__cfDb = { file, client: create() }
  return g.__cfDb.client
}
