'use client'
import { Button } from '@/components/ui/button'

export function SaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return <Button className="self-start" disabled={saving} onClick={onSave}>Save changes</Button>
}
