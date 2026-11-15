'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SETTINGS_SECTIONS } from '@/lib/constants'
import { cn } from '@/lib/utils'


export function SettingsNav() {
  const path = usePathname()
  return (
    <nav aria-label="Settings sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:sticky md:top-20 md:mx-0 md:flex-col md:self-start md:overflow-visible md:px-0">
      {SETTINGS_SECTIONS.map(([id, label]) => {
        const active = path === `/settings/${id}`
        return (
          <Link key={id} href={`/settings/${id}`} aria-current={active ? 'page' : undefined}
            className={cn('shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150',
              active ? 'bg-card shadow-cf' : 'text-muted-foreground hover:text-foreground')}>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
