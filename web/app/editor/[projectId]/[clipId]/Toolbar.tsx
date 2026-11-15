'use client'
import Link from 'next/link'
import { ArrowLeft, Pause, Play, Redo2, RectangleHorizontal, RectangleVertical, Square, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/cf/Segmented'
import { ThemeToggle } from '@/components/cf/ThemeToggle'
import type { Aspect } from '@/lib/editor'

export function Toolbar({ title, backHref, aspect, onAspect, canUndo, canRedo, onUndo, onRedo, playing, onPlay, onExport }: {
  title: string; backHref: string; aspect: Aspect; onAspect: (a: Aspect) => void
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; playing: boolean; onPlay: () => void; onExport: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
      <Button variant="ghost" size="icon" asChild aria-label="Back to clips"><Link href={backHref}><ArrowLeft /></Link></Button>
      <span className="max-w-64 truncate text-sm font-semibold">{title}</span>
      <div className="ml-3 flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}><Undo2 /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}><Redo2 /></Button>
      </div>
      <div className="mx-auto">
        <Segmented aria-label="Aspect ratio" size="sm" value={aspect} onChange={onAspect} options={[
          { value: '9:16', label: '9:16', icon: <RectangleVertical className="size-3.5" /> },
          { value: '1:1', label: '1:1', icon: <Square className="size-3.5" /> },
          { value: '16:9', label: '16:9', icon: <RectangleHorizontal className="size-3.5" /> },
        ]} />
      </div>
      <ThemeToggle />
      <Button variant="secondary" size="sm" onClick={onPlay}>{playing ? <Pause /> : <Play />} Preview</Button>
      <Button size="sm" onClick={onExport}>Export</Button>
    </header>
  )
}
