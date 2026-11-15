import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { ClipsView } from '@/components/cf/ClipsView'
import { PageSkeleton } from '@/components/cf/PageSkeleton'
import { fmtDuration } from '@/lib/clips'
import { getMockClips, getMockProject, mockProjects } from '@/lib/mock'

export const generateStaticParams = () => mockProjects.map((p) => ({ id: p.id }))

async function Clips({ params }: { params: Promise<{ id: string }> }) {
  const project = getMockProject((await params).id)
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
