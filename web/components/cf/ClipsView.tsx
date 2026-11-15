'use client'
import { useMemo, useState } from 'react'
import { SearchX } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { sortClips, type ClipSort } from '@/lib/clips'
import type { MockClip } from '@/lib/mock'
import { CfSlider } from './CfSlider'
import { ClipCard } from './ClipCard'
import { ClipDetails } from './ClipDetails'
import { EmptyState } from './EmptyState'
import { Segmented } from './Segmented'

export function ClipsView({ clips, thumbnail }: { clips: MockClip[]; thumbnail: string }) {
  const [sort, setSort] = useState<ClipSort>('score')
  const [min, setMin] = useState(0)
  const [open, setOpen] = useState<MockClip | null>(null)
  const shown = useMemo(() => sortClips(clips, sort, sort === 'time' ? 'asc' : 'desc').filter((c) => c.score >= min), [clips, sort, min])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Sort by</span>
          <Segmented aria-label="Sort by" value={sort} onChange={setSort}
            options={[{ value: 'score', label: 'Score' }, { value: 'duration', label: 'Duration' }, { value: 'time', label: 'Time' }]} />
        </div>
        <CfSlider label="Minimum score" min={0} max={100} step={5} value={min} onChange={setMin} className="w-full max-w-56" />
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} of {clips.length} clips</span>
      </div>
      {shown.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((c) => <ClipCard key={c.id} clip={c} thumbnail={thumbnail} onOpen={() => setOpen(c)} />)}
        </div>
      ) : (
        <EmptyState icon={<SearchX />} title="No clips at this score" body="Lower the minimum score to see more clips." />
      )}
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {open && (
            <>
              <SheetHeader><SheetTitle>{open.titles[0]}</SheetTitle><SheetDescription>Viral score breakdown and copy for each platform.</SheetDescription></SheetHeader>
              <div className="px-4 pb-6"><ClipDetails clip={open} /></div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
