import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { ClipsView } from '@/components/cf/ClipsView'
import { PageSkeleton } from '@/components/cf/PageSkeleton'
import { fmtDuration } from '@/lib/clips'
import { RealClips } from '@/components/cf/RealClips'
import { getMockClips, getMockProject, mockProjects } from '@/lib/mock'
import { getProject } from '@/lib/projects'

export const generateStaticParams = () => mockProjects.map((p) => ({ id: p.id }))

async function Clips({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const real = getMockProject(id) ? null : await getProject(id)
  if (real) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{real.title}</h1>
          <p className="text-sm text-muted-foreground"><span className="capitalize">{real.contentType}</span>{real.durationSec ? ` · ${fmtDuration(real.durationSec)} source` : ''} · <a className="underline" href={`/projects/${id}/transcript`}>Transcript</a></p>
        </div>
        <RealClips initial={real} />
      </div>
    )
  }
  const project = getMockProject(id)
  if (!project) notFound()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground"><span className="capitalize">{project.contentType}</span> · {fmtDuration(project.durationSec)} source</p>
      </div>
      <ClipsView clips={getMockClips(project.id)} thumbnail={project.thumbnail} />
    </div>
  )
}

export default function ClipsPage({ params }: PageProps<'/projects/[id]/clips'>) {
  return <Suspense fallback={<PageSkeleton />}><Clips params={params} /></Suspense>
}
