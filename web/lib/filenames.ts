/** A download/ZIP name from a clip title: no path or shell-hostile characters, ≤ 80 chars. Same rule as worker render/graph.py. */
export function safeFilename(title: string, ext: string): string {
  const s0 = (title ?? '').replace(/[/\\:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '')
  const s80 = Array.from(s0).slice(0, 80).join('').trim() || 'clip' // by character: slicing UTF-16 can split an emoji
  return `${s80}.${ext}`
}

/** Content-Disposition with an ASCII fallback and the full UTF-8 name (RFC 6266). */
export const attachment = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`
