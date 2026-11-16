'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Clapperboard, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { mockProjects } from '@/lib/mock'
import type { ProjectView } from '@/lib/projects'
import { EmptyState } from './EmptyState'
import { ProjectCard, type CardData } from './ProjectCard'

const realCard = (p: ProjectView): CardData => ({
  id: p.id, title: p.title, status: p.status, contentType: p.contentType, durationSec: p.durationSec,
  thumbnailUrl: p.thumbnailUrl, progress: p.progress, stage: p.stage, clipCount: p.clipCount,
  href: p.status === 'ready' && p.clipCount ? `/projects/${p.id}/clips` : p.status === 'ready' || p.jobType !== 'ingest' ? `/projects/${p.id}/${p.clipCount ? 'clips' : 'transcript'}` : `/projects/${p.id}/processing`,
})
const demoCard = (p: (typeof mockProjects)[number]): CardData => ({
  id: p.id, title: p.title, status: p.status, contentType: p.contentType, durationSec: p.durationSec, gradient: p.thumbnail,
  progress: p.progress, clipCount: p.clipCount, demo: true,
  href: p.status === 'ready' ? `/projects/${p.id}/clips` : `/projects/${p.id}/processing`,
})

const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>

export function LibraryGrid() {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  const load = useCallback(() => fetch('/api/projects').then((r) => r.json()).then(setProjects).catch(() => toast.error("Couldn't load projects")), [])

  useEffect(() => { load() }, [load])
  useEffect(() => { // keep cards live while something is processing
    if (!projects?.some((p) => p.status === 'processing' || p.status === 'queued')) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [projects, load])

  const remove = async (id: string) => {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't delete")
    setProjects((ps) => ps?.filter((p) => p.id !== id) ?? null)
    toast.success('Project deleted')
  }

  if (!projects) return <LibrarySkeleton />
  return (
    <div className="flex flex-col gap-10">
      {projects.length ? (
        <Grid>{projects.map((p) => <ProjectCard key={p.id} p={realCard(p)} onDelete={() => remove(p.id)} />)}</Grid>
      ) : (
        <EmptyState icon={<Clapperboard />} title="No projects yet" body="Upload a video or paste a link and ClipForge will find the best moments."
          action={<Button asChild><Link href="/new"><Plus /> New project</Link></Button>} />
      )}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Demo projects</h2>
          <p className="text-sm text-muted-foreground">Sample data to explore the clips page and editor until clip finding arrives in Phase 3.</p>
        </div>
        <Grid>{mockProjects.map((p) => <ProjectCard key={p.id} p={demoCard(p)} />)}</Grid>
      </section>
    </div>
  )
}

export function LibrarySkeleton() {
  return (
    <Grid>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl bg-card shadow-cf">
          <div className="aspect-video animate-pulse bg-muted" />
          <div className="space-y-2 p-3.5"><div className="h-4 w-3/4 animate-pulse rounded bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-muted" /></div>
        </div>
      ))}
    </Grid>
  )
}
