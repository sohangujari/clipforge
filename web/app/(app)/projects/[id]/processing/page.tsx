import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { PageSkeleton } from '@/components/cf/PageSkeleton'
import { ProcessingView } from '@/components/cf/ProcessingView'
import { getMockProject, mockProjects } from '@/lib/mock'

export const generateStaticParams = () => mockProjects.map((p) => ({ id: p.id }))

async function Processing({ params }: { params: Promise<{ id: string }> }) {
  const project = getMockProject((await params).id)
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
