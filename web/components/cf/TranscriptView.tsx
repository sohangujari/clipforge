import { fmtDuration } from '@/lib/clips'

interface W { w: string; s: number; e: number }
const GAP_S = 1.5

/** Words grouped into paragraphs at pauses longer than 1.5 s. */
export function paragraphs(words: W[]): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = []
  let prev: W | undefined
  for (const w of words) {
    if (!prev || w.s - prev.e > GAP_S) out.push({ start: w.s, text: w.w })
    else out[out.length - 1].text += ' ' + w.w
    prev = w
  }
  return out
}

export function TranscriptView({ words }: { words: W[] }) {
  return (
    <div data-testid="transcript" className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-cf">
      {paragraphs(words).map((p, i) => (
        <p key={i} className="grid grid-cols-[3.5rem_1fr] gap-3 text-sm leading-relaxed">
          <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{fmtDuration(p.start)}</span>
          <span>{p.text}</span>
        </p>
      ))}
    </div>
  )
}
