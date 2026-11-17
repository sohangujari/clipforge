import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '@/lib/paths'

const MAX = 100 * 1024 * 1024

/** MP4 / MOV ("ftyp" box) or WebM (EBML header), by content — not by the name or type the browser claims. */
function sniff(buf: Buffer): 'mp4' | 'mov' | 'webm' | null {
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return buf.subarray(8, 10).toString('latin1') === 'qt' ? 'mov' : 'mp4'
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm'
  return null
}

/** An intro or outro video for the brand kit; the export scales it to each clip's size. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'No file' }, { status: 400 })
  if (file.size > MAX) return Response.json({ error: 'Intro and outro videos must be 100 MB or smaller' }, { status: 400 })
  const buf = Buffer.from(await file.arrayBuffer())
  const ext = buf.length >= 12 ? sniff(buf) : null
  if (!ext) return Response.json({ error: 'Use an MP4, MOV or WebM video' }, { status: 400 })
  const rel = `bumpers/${randomUUID()}.${ext}`
  writeFileSync(join(/*turbopackIgnore: true*/ dataDir(), rel), buf)
  return Response.json({ path: rel })
}
