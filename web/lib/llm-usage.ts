import 'server-only'
import { getSetting, setSetting } from './settings'

/** Free-tier quotas reset at midnight Pacific, so "today" is the Pacific date. */
const pacificDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

export async function countRequest(provider: string, model: string): Promise<void> {
  const u = await getSetting('llmUsage')
  const today = pacificDate()
  const counts = u.date === today ? { ...u.counts } : {}
  const key = `${provider}:${model}`
  counts[key] = (counts[key] ?? 0) + 1
  await setSetting('llmUsage', { date: today, counts })
}

export async function todayUsage(): Promise<Record<string, number>> {
  const u = await getSetting('llmUsage')
  return u.date === pacificDate() ? u.counts : {}
}
