import { totalmem } from 'node:os'
import { connection } from 'next/server'

export async function GET() {
  await connection()
  return Response.json({ totalMemBytes: totalmem() })
}
