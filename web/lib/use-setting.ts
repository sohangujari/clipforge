'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

/** Load a setting, edit locally, save explicitly. */
export function useSetting<T>(key: string, label: string) {
  const [value, setValue] = useState<T | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/settings/${key}`).then((r) => r.json()).then(setValue).catch(() => toast.error(`Couldn't load ${label.toLowerCase()}`))
  }, [key, label])

  const save = useCallback(async (next?: T) => {
    const body = next ?? value
    setSaving(true)
    try {
      const res = await fetch(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed')
      setValue(await res.json())
      toast.success(`${label} saved`)
    } catch (e) {
      toast.error(`Couldn't save: ${(e as Error).message}`)
    } finally { setSaving(false) }
  }, [key, label, value])

  return { value, setValue, save, saving }
}
