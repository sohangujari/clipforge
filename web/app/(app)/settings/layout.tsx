import { Suspense } from 'react'
import { SettingsNav } from '@/components/cf/SettingsNav'

export default function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Stored locally in your ClipForge data folder.</p>
      </div>
      <div className="grid min-w-0 gap-6 md:grid-cols-[200px_1fr]">
        <Suspense><SettingsNav /></Suspense>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
