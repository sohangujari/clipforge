import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { getMockProject } from '@/lib/mock'
import { getProject } from '@/lib/projects'

async function Go({ params }: { params: Promise<{ id: string }> }): Promise<null> {
  const { id } = await params
  const mock = getMockProject(id)
  if (mock) redirect(`/projects/${id}/${mock.status === 'ready' ? 'clips' : 'processing'}`)
  const p = await getProject(id)
  if (!p) notFound()
  redirect(`/projects/${id}/${p.status !== 'ready' ? 'processing' : p.clipCount ? 'clips' : 'transcript'}`)
}

export default function ProjectPage({ params }: PageProps<'/projects/[id]'>) {
  return <Suspense><Go params={params} /></Suspense>
}
