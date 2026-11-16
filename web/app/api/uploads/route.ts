import { handle } from '@/lib/projects'
import { initUpload } from '@/lib/uploads'

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name: string; size: number; lastModified: number }
  return handle(async () => initUpload(b))
}
