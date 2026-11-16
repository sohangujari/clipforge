import { statSync } from 'node:fs'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { connection } from 'next/server'
import { dataDir } from '@/lib/paths'

const ALIVE_MS = 15_000 // the worker touches data/.worker-alive every 5 s

function workerAlive(): boolean {
  try { return Date.now() - statSync(join(/*turbopackIgnore: true*/ dataDir(), '.worker-alive')).mtimeMs < ALIVE_MS } catch { return false }
}

export async function GET() {
  await connection()
  return Response.json({ totalMemBytes: totalmem(), workerAlive: workerAlive() })
}
