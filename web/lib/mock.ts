// Phase 1 fixtures. Replaced by DB-backed projects and clips in Phases 2–3.
import type { ContentType } from './layouts'

export type ProjectStatus = 'queued' | 'processing' | 'ready' | 'failed'
export const STAGES = ['importing', 'transcribing', 'detecting', 'analyzing', 'reframing'] as const
export type Stage = (typeof STAGES)[number]

export interface MockProject {
  id: string; title: string; durationSec: number; status: ProjectStatus; stage?: Stage; progress?: number
  clipCount: number; contentType: ContentType; thumbnail: string; createdAt: string; error?: string
}
export interface ScoreBreakdown { hook: number; emotion: number; value: number; pacing: number; trend: number; extra?: Record<string, number> }
export interface Word { w: string; s: number; e: number; speaker?: number }
export interface MockClip {
  id: string; projectId: string; startSec: number; endSec: number; score: number; breakdown: ScoreBreakdown
  reason: string; tips: string[]; titles: [string, string, string]
  descriptions: { shorts: string; tiktok: string; reels: string }; hashtags: string[]; transcript: Word[]
}

export const mockProjects: MockProject[] = [
  { id: 'p-podcast', title: 'Founders Talk #142 — Building in public', durationSec: 5832, status: 'ready', clipCount: 10, contentType: 'podcast', thumbnail: 'linear-gradient(135deg,#3b2f63,#c0587e)', createdAt: '2026-11-14T16:20:00Z' },
  { id: 'p-gaming', title: 'Late night heists — full stream VOD', durationSec: 14420, status: 'ready', clipCount: 9, contentType: 'gaming', thumbnail: 'linear-gradient(135deg,#0f3d3e,#3fa796)', createdAt: '2026-11-13T21:05:00Z' },
  { id: 'p-processing', title: 'How I edit 10x faster (tutorial)', durationSec: 1910, status: 'processing', stage: 'analyzing', progress: 0.6, clipCount: 0, contentType: 'tutorial', thumbnail: 'linear-gradient(135deg,#2b3a55,#6b8cce)', createdAt: '2026-11-15T09:12:00Z' },
  { id: 'p-failed', title: 'Weekend vlog — Lisbon', durationSec: 1204, status: 'failed', clipCount: 0, contentType: 'vlog', thumbnail: 'linear-gradient(135deg,#5a3e2b,#d49a6a)', createdAt: '2026-11-12T11:00:00Z', error: 'Download failed: video is private' },
  { id: 'p-queued', title: 'Reacting to the new trailer', durationSec: 980, status: 'queued', clipCount: 0, contentType: 'reaction', thumbnail: 'linear-gradient(135deg,#40214f,#9b5de5)', createdAt: '2026-11-15T09:30:00Z' },
]

export const getMockProject = (id: string) => mockProjects.find((p) => p.id === id)

const LINES: Record<string, string[]> = {
  'p-podcast': [
    'Nobody tells you that the first hundred customers are the hardest part of the whole thing',
    'I almost shut the company down twice and both times a single email changed my mind',
    'If you are not embarrassed by your first launch you waited way too long',
    'We doubled revenue the month we stopped adding features and started talking to users',
    'The best hire I ever made had zero experience and an obsessive curiosity',
    'Pricing is a story you tell about your product not a number on a page',
    'Burnout does not announce itself it just quietly takes your weekends',
    'Building in public felt terrifying until the first stranger cheered us on',
    'Most advice is survivorship bias with a nice microphone',
    'Your competitors are not your problem your silence is',
  ],
  'p-gaming': [
    'No no no wait wait he is right behind me go go go',
    'That was the cleanest getaway I have ever pulled off chat',
    'Okay I am never trusting that bridge again ever',
    'Three of them on the roof and I have one bullet let us go',
    'Bro the car just flew into the ocean what was that physics',
    'Chat said clip it so here we are clip it',
    'I spent forty minutes setting this up and it lasted four seconds',
    'Wait is that the new map nobody told me about this',
    'Clutch or kick here we go one versus three',
  ],
}

const SCORES = [94, 88, 82, 76, 71, 67, 62, 55, 48, 41]
const rnd = (seed: number) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x) }

function words(line: string, start: number, speakers: number): Word[] {
  let t = start
  return line.split(' ').map((w, i) => {
    const d = 0.22 + rnd(start + i) * 0.25
    const word = { w, s: +t.toFixed(2), e: +(t + d).toFixed(2), speaker: speakers > 1 ? Math.floor(i / 6) % speakers : 0 }
    t += d + 0.04
    return word
  })
}

export function getMockClips(projectId: string): MockClip[] {
  const lines = LINES[projectId]
  if (!lines) return []
  const gaming = projectId === 'p-gaming'
  return lines.map((line, i): MockClip => {
    const score = SCORES[i]
    const startSec = 180 + i * 431 + Math.round(rnd(i) * 90)
    const len = 22 + Math.round(rnd(i + 7) * 48)
    const j = (k: number) => Math.max(20, Math.min(99, score + Math.round((rnd(i * 5 + k) - 0.5) * 24)))
    const hook = line.split(' ').slice(0, 6).join(' ')
    return {
      id: `${projectId}-c${i + 1}`, projectId, startSec, endSec: startSec + len, score,
      breakdown: { hook: j(1), emotion: j(2), value: j(3), pacing: j(4), trend: j(5), extra: (gaming ? { reaction: j(6), action: j(7) } : { quotability: j(6) }) as Record<string, number> },
      reason: score >= 80 ? 'Strong hook in the first 2 seconds and a complete, quotable thought.' : score >= 60 ? 'Good payoff, but the opening takes a few seconds to land.' : 'Interesting idea, but it lacks a clear hook and trails off.',
      tips: ['Start the clip 1.5s later to open on the hook', 'Add keyword emphasis on the payoff line'],
      titles: [`${hook}…`.slice(0, 58), gaming ? 'This went sideways FAST 😳' : 'The lesson nobody tells founders', gaming ? 'Chat could not believe this' : 'Steal this mindset'],
      descriptions: {
        shorts: `${line}. Full episode on the channel.`,
        tiktok: `${line} 🤯 #fyp`,
        reels: `${line}. Save this for later 👇`,
      },
      hashtags: gaming ? ['#gaming', '#twitch', '#clips', '#funny', '#streamer', '#fyp'] : ['#startup', '#founder', '#podcast', '#business', '#motivation', '#entrepreneur'],
      transcript: words(line, startSec, gaming ? 1 : 2),
    }
  })
}
