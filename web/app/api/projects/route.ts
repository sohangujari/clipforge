import { connection } from 'next/server'
import { createProject, handle, listProjects, ProjectSettingsSchema } from '@/lib/projects'

export async function GET() {
  await connection()
  return Response.json(await listProjects())
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown; settings?: unknown; contentType?: string }
  return handle(async () => createProject({ sourceType: 'url', url: String(body.url ?? ''), settings: ProjectSettingsSchema.parse(body.settings ?? {}), contentType: body.contentType }), 201)
}
