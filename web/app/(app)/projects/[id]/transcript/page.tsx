import { Suspense } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { notFound, redirect } from 'next/navigation'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { FindClipsButton } from '@/components/cf/FindClipsButton'
import { PageSkeleton } from '@/components/cf/PageSkeleton'
import { TranscriptView } from '@/components/cf/TranscriptView'
import { fmtDuration } from '@/lib/clips'
import { dataDir } from '@/lib/paths'
import { getProject } from '@/lib/projects'

const LANG: Record<string, string> = { en: 'English', hi: 'Hindi', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' }

async function Transcript({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await getProject(id)
  if (!p) notFound()
  if (!p.hasTranscript) redirect(`/projects/${id}/processing`)
  const t = JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ dataDir(), 'media', id, 'transcript.json'), 'utf8'))
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{p.title}</h1>
        <p className="text-sm text-muted-foreground">
          {p.durationSec ? `${fmtDuration(p.durationSec)} · ` : ''}{LANG[t.language] ?? t.language ?? 'Unknown language'} · {t.words.length.toLocaleString()} words
        </p>
      </div>
      {p.warning && <p className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"><TriangleAlert className="size-4 shrink-0" />{p.warning}</p>}
      {p.clipCount ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground"><Sparkles className="size-4 text-cf-accent" />{p.clipCount} clips found. <a href={`/projects/${id}/clips`} className="font-medium text-foreground underline">See clips</a></p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground"><Sparkles className="size-4 text-cf-accent" />No clips yet for this video.<span className="ml-auto"><FindClipsButton projectId={id} /></span></div>
      )}
      <TranscriptView words={t.words} />
    </div>
  )
}

export default function TranscriptPage({ params }: PageProps<'/projects/[id]/transcript'>) {
  return <Suspense fallback={<PageSkeleton />}><Transcript params={params} /></Suspense>
}
