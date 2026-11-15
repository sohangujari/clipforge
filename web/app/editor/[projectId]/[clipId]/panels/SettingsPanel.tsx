'use client'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

const LINKS = [['ai', 'AI providers & models'], ['brand', 'Brand kit'], ['subtitles', 'Subtitle presets'], ['layouts', 'Layout templates'], ['defaults', 'Defaults'], ['profile', 'Profile']]

export function SettingsPanel() {
  return (
    <div className="flex flex-col gap-1">
      {LINKS.map(([id, label]) => (
        <Link key={id} href={`/settings/${id}`} className="flex items-center justify-between rounded-xl p-3 text-sm hover:bg-card">
          {label}<ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )
}
