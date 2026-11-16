import { getProject, isTerminal } from '@/lib/projects'

const POLL_MS = 500

/** SSE: pushes the ProjectView whenever it changes; closes after a terminal state or when the client leaves. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = ''
      while (!req.signal.aborted) {
        const view = await getProject(id)
        if (!view) { controller.enqueue(enc.encode('event: gone\ndata: {}\n\n')); break }
        const json = JSON.stringify(view)
        if (json !== last) { controller.enqueue(enc.encode(`data: ${json}\n\n`)); last = json }
        if (isTerminal(view.status)) break
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } })
}
