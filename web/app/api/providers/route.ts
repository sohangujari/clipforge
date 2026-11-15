import { connection } from 'next/server'
import { listProviderViews } from '@/lib/providers-store'

export async function GET() {
  await connection() // always per-request (cacheComponents would otherwise prerender this)
  return Response.json(await listProviderViews())
}
