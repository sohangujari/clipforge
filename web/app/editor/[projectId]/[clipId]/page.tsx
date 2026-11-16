import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { listClips } from '@/lib/clip-views'
import { getMockClips, mockProjects, type MockProject } from '@/lib/mock'
import { getProject } from '@/lib/projects'
import { EditorShell } from './EditorShell'

export const generateStaticParams = () =>
  mockProjects.flatMap((p) => getMockClips(p.id).map((c) => ({ projectId: p.id, clipId: c.id })))

const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Courier+Prime:wght@700&family=Inter:wght@400;600;700;900&family=Montserrat:wght@600;800;900&family=Poppins:wght@600;700;800&display=swap'

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
  // ponytail: the canvas shows placeholder regions until rendering arrives in Phase 4; subtitles use the real words
  const project: MockProject = { id: real.id, title: real.title, durationSec: real.durationSec ?? clip.endSec + 30, status: 'ready', clipCount: real.clipCount,
    contentType: real.contentType as MockProject['contentType'], thumbnail: 'linear-gradient(135deg,#3f3f46,#71717a)', createdAt: real.createdAt }
  return <EditorShell project={project} clip={clip} clips={clips} />
}

export default function EditorPage({ params }: PageProps<'/editor/[projectId]/[clipId]'>) {
  return (
    <>
      <link rel="stylesheet" href={FONTS_CSS} precedence="default" />
      <Suspense fallback={<div className="m-auto size-8 animate-spin rounded-full border-2 border-muted border-t-cf-accent" />}>
        <Editor params={params} />
      </Suspense>
    </>
  )
}
