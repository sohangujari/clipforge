'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Clapperboard, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { mockProjects } from '@/lib/mock'
import { EmptyState } from './EmptyState'
import { ProjectCard } from './ProjectCard'

export function LibraryGrid() {
  const empty = useSearchParams().get('empty') === '1'
  if (empty || !mockProjects.length) {
    return (
      <EmptyState icon={<Clapperboard />} title="No projects yet" body="Upload a video or paste a link and ClipForge will find the best moments."
        action={<Button asChild><Link href="/new"><Plus /> New project</Link></Button>} />
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {mockProjects.map((p) => <ProjectCard key={p.id} p={p} />)}
    </div>
  )
}

export function LibrarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl bg-card shadow-cf">
          <div className="aspect-video animate-pulse bg-muted" />
          <div className="space-y-2 p-3.5"><div className="h-4 w-3/4 animate-pulse rounded bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-muted" /></div>
        </div>
      ))}
    </div>
  )
}
