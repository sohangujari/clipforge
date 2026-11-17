import { handle, importChat, MAX_CHAT_BYTES, ProjectError } from '@/lib/projects'

/** POST the chat log file as the body; the next Find clips uses it. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handle(async () => {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_CHAT_BYTES) throw new ProjectError(413, 'Chat files up to 100 MB are supported')
    return importChat(id, await req.arrayBuffer())
  })
}
