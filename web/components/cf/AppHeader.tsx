import Link from 'next/link'
import { Plus, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from './ThemeToggle'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Link href="/" className="mr-2 flex items-center gap-2 font-bold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Scissors className="size-4" /></span>
          <span className="hidden sm:inline">ClipForge</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" asChild><Link href="/">Projects</Link></Button>
          <Button variant="ghost" size="sm" asChild><Link href="/settings/ai">Settings</Link></Button>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button size="sm" asChild><Link href="/new"><Plus /> <span className="hidden sm:inline">New project</span></Link></Button>
        </div>
      </div>
    </header>
  )
}
