import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { PageSkeleton } from '@/components/cf/PageSkeleton'
import { ProcessingView } from '@/components/cf/ProcessingView'
import { LiveProcessing } from '@/components/cf/LiveProcessing'
import { getMockProject, mockProjects } from '@/lib/mock'
import { getProject } from '@/lib/projects'

export const generateStaticParams = () => mockProjects.map((p) => ({ id: p.id }))

async function Processing({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const real = getMockProject(id) ? null : await getProject(id)
  if (real) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{real.title}</h1>
          <p className="text-sm text-muted-foreground">Processing runs on this computer — you can leave this page.</p>
        </div>
        <LiveProcessing initial={real} />
      </div>
    )
  }
  const project = getMockProject(id)
  if (!project) notFound()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground">Processing runs on this Mac — you can leave this page.</p>
      </div>
      <ProcessingView project={project} />
    </div>
  )
}

export default function ProcessingPage({ params }: PageProps<'/projects/[id]/processing'>) {
  return <Suspense fallback={<PageSkeleton />}><Processing params={params} /></Suspense>
}
