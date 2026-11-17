'use client'
import { LayoutTemplate as Icon, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/cf/EmptyState'
import { LAYOUTS } from '@/lib/layouts'
import type { LayoutTemplate } from '@/lib/layout-templates'
import { useSetting } from '@/lib/use-setting'

export function LayoutsSection() {
  const { value, save } = useSetting<LayoutTemplate[]>('layoutTemplates', 'Layout templates')
  if (!value) return <div className="h-40 animate-pulse rounded-xl bg-muted" />
  if (!value.length) return <EmptyState icon={<Icon />} title="No layout templates yet" body="In the editor, open Layout and save a clip's framing as a template — e.g. “Podcast 2-cam” — to reuse it on other clips." />
  return (
    <section className="flex flex-col divide-y rounded-xl bg-card shadow-cf">
      {value.map((t) => (
        <div key={t.id} className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t.name}</p>
            <p className="text-xs text-muted-foreground">{LAYOUTS.find((l) => l.id === t.layoutId)?.label} · {t.aspect} · subtitles {t.subtitles.position}</p>
          </div>
          <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => save(value.filter((x) => x.id !== t.id))}><Trash2 /></Button>
        </div>
      ))}
    </section>
  )
}
