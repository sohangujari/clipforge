import { Suspense } from 'react'
import { LibraryGrid, LibrarySkeleton } from '@/components/cf/LibraryGrid'

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">Your videos and the clips found in them.</p>
      </div>
      <Suspense fallback={<LibrarySkeleton />}><LibraryGrid /></Suspense>
    </div>
  )
}
