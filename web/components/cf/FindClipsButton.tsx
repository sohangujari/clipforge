'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/** For transcripts without clips yet (e.g. no AI model was set, or Phase 2 projects). */
export function FindClipsButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <Button disabled={busy} onClick={async () => {
      setBusy(true)
      const res = await fetch(`/api/projects/${projectId}/analyze`, { method: 'POST' })
      if (!res.ok) { setBusy(false); return toast.error((await res.json()).error ?? 'Something went wrong') }
      router.push(`/projects/${projectId}/processing`)
    }}><Sparkles /> Find clips</Button>
  )
}
