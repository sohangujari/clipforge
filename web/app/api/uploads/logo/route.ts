import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '@/lib/paths'

const MAX = 5 * 1024 * 1024
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function sniff(buf: Buffer): 'png' | 'svg' | null {
  if (PNG.every((b, i) => buf[i] === b)) return 'png'
  const head = buf.subarray(0, 1024).toString('utf8').trimStart()
  if ((head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!--')) && head.includes('<svg')) return 'svg'
  return null
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'No file' }, { status: 400 })
  if (file.size > MAX) return Response.json({ error: 'Logo must be 5 MB or smaller' }, { status: 400 })
  const buf = Buffer.from(await file.arrayBuffer())
  const ext = sniff(buf)
  if (!ext) return Response.json({ error: 'Logo must be a PNG or SVG' }, { status: 400 })
  // An SVG comes with the PNG the browser rendered from it: FFmpeg can't read SVG, so the export uses the PNG.
  const png = ext === 'svg' ? form!.get('png') : null
  let pngBuf: Buffer | null = null
  if (png instanceof File) {
    pngBuf = Buffer.from(await png.arrayBuffer())
    if (png.size > MAX || sniff(pngBuf) !== 'png') return Response.json({ error: 'The rendered logo must be a PNG' }, { status: 400 })
  }
  const id = randomUUID(), rel = `logos/${id}.${ext}`
  writeFileSync(join(/*turbopackIgnore: true*/ dataDir(), rel), buf)
  if (pngBuf) writeFileSync(join(/*turbopackIgnore: true*/ dataDir(), `logos/${id}.png`), pngBuf)
  return Response.json({ path: rel, ...(pngBuf && { pngPath: `logos/${id}.png` }) })
}
