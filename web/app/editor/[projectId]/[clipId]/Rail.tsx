'use client'
import { Download, Film, LayoutPanelTop, Palette, Settings, Sparkles, Type } from 'lucide-react'
import { cn } from '@/lib/utils'

export const SECTIONS = [
  { id: 'clips', label: 'Clips', icon: Film },
  { id: 'layout', label: 'Layout', icon: LayoutPanelTop },
  { id: 'subtitles', label: 'Subtitles', icon: Type },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'export', label: 'Export', icon: Download },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const
export type SectionId = (typeof SECTIONS)[number]['id']

export function Rail({ value, onChange }: { value: SectionId; onChange: (s: SectionId) => void }) {
  return (
    <nav data-testid="rail" aria-label="Editor sections" className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-l bg-cf-panel py-3">
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-current={value === id ? 'page' : undefined} onClick={() => onChange(id)}
          className={cn('flex w-[62px] flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-all duration-150',
            value === id ? 'bg-card text-foreground shadow-cf' : 'text-muted-foreground hover:text-foreground')}>
          <Icon className={cn('size-[18px]', value === id && 'text-cf-accent')} />{label}
        </button>
      ))}
    </nav>
  )
}
