// Blocks other websites from driving the local API (creating imports, cancelling, uploading) through the
// user's browser. Reads stay open; non-browser clients (curl, scripts) send no Origin/Sec-Fetch-Site and pass.
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function proxy(request: Request): Response | undefined {
  const url = new URL(request.url)
  if (!WRITE.has(request.method) || url.pathname.startsWith('/api/internal/')) return undefined // internal = token-guarded
  const site = request.headers.get('sec-fetch-site')
  const origin = request.headers.get('origin')
  const host = request.headers.get('host') ?? url.host
  const foreignOrigin = origin !== null && (() => { try { return new URL(origin).host !== host } catch { return true } })()
  if ((site && site !== 'same-origin' && site !== 'none') || foreignOrigin) {
    return Response.json({ error: 'Cross-site requests are not allowed' }, { status: 403 })
  }
  return undefined
}

export const config = { matcher: '/api/:path*' }
