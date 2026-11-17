import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { listClips, readSilences, readWords } from '@/lib/clip-views'
import { getMockClips, mockProjects, type MockProject } from '@/lib/mock'
import { getProject } from '@/lib/projects'
import { EditorShell } from './EditorShell'

export const generateStaticParams = () =>
  mockProjects.flatMap((p) => getMockClips(p.id).map((c) => ({ projectId: p.id, clipId: c.id })))

async function Editor({ params }: { params: Promise<{ projectId: string; clipId: string }> }) {
  const { projectId, clipId } = await params
  const mock = mockProjects.find((p) => p.id === projectId)
  if (mock) {
    const clips = getMockClips(projectId)
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) notFound()
    return <EditorShell project={mock} clip={clip} clips={clips} />
  }
  const real = await getProject(projectId)
  const clips = real ? await listClips(projectId) : []
  const clip = clips.find((c) => c.id === clipId)
  if (!real || !clip) notFound()
  const project: MockProject = { id: real.id, title: real.title, durationSec: real.durationSec ?? clip.endSec + 30, status: 'ready', clipCount: real.clipCount,
    contentType: real.contentType as MockProject['contentType'], thumbnail: 'linear-gradient(135deg,#3f3f46,#71717a)', createdAt: real.createdAt }
  const words = readWords(projectId).filter((w) => w.s >= clip.startSec - 30 && w.e <= clip.endSec + 30) // the timeline shows ±30 s
  const media = `/api/files/media/${projectId}`
  return <EditorShell project={project} clip={{ ...clip, transcript: words }} clips={clips}
    real={{ proxyUrl: `${media}/proxy.mp4`, trackUrl: `${media}/track.json`, peopleUrl: `${media}/people.json`, edit: clip.edit, keywords: clip.keywords, hook: clip.hook,
      silences: readSilences(projectId).filter(([a, b]) => b > clip.startSec - 30 && a < clip.endSec + 30) }} />
}

export default function EditorPage({ params }: PageProps<'/editor/[projectId]/[clipId]'>) {
  return (
    <>
      <Suspense fallback={<div className="m-auto size-8 animate-spin rounded-full border-2 border-muted border-t-cf-accent" />}>
        <Editor params={params} />
      </Suspense>
    </>
  )
}
