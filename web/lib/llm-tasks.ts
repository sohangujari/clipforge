import { z } from 'zod'
import { CONTENT_TYPES } from './constants'

type Slot = 'highlight' | 'scoring' | 'titles' | 'vision'
export interface LlmTask<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  input: I
  output: O
  slots: Slot[]
  system: (input: z.output<I>) => string
  prompt: (input: z.output<I>) => string
}
const task = <I extends z.ZodType, O extends z.ZodType>(t: LlmTask<I, O>) => t

const TYPES = CONTENT_TYPES.filter((t) => t !== 'auto') as [string, ...string[]]
const CUE = z.enum(['laughter', 'applause', 'cheering', 'loud', 'fast'])
const Sentence = z.object({ id: z.number().int().min(0), t: z.string().max(10), text: z.string().max(2000), cues: z.array(CUE).max(5).default([]) })
// Model output is trimmed/clamped, never rejected: one over-long string must not throw away a whole batch of clips.
const txt = (n: number) => z.string().overwrite((s) => s.slice(0, n))
const upTo = <T extends z.ZodType>(item: T, n: number) => z.array(item).overwrite((a) => a.slice(0, n))
const pct = z.number().overwrite((n) => Math.min(100, Math.max(0, n)))
const tag = z.string().overwrite((s) => `#${s.replace(/[#\s]/g, '')}`)
const Candidate = z.object({ startId: z.number().int(), endId: z.number().int(), hookId: z.number().int(), why: txt(200),
  kind: z.enum(['story', 'opinion', 'joke', 'insight', 'debate', 'qa', 'reaction', 'moment']).catch('moment') })
const Examples = z.object({ kept: z.array(z.string().max(400)).max(8).default([]), deleted: z.array(z.string().max(400)).max(8).default([]) }).default({ kept: [], deleted: [] })

/** What makes a great clip, per content type (from the spec). */
export const FOCUS: Record<string, string> = {
  podcast: 'strong opinions, stories with a payoff, debates or disagreements, laughter, quotable one-liners, complete question-and-answer exchanges',
  gaming: 'big reactions (shouting, laughing, shock), clutch plays and fails, funny glitches, chases, wins, moments chat would clip',
  vlog: 'emotional beats, surprising reveals, relatable moments, strong one-liners, a mini story with a clear ending',
  tutorial: 'the single most useful tip, a surprising shortcut, a before/after result, a common mistake and its fix',
  reaction: "the reactor's strongest reactions (laughing, shock, disagreement) and the moment that caused them",
  sports: 'the decisive play, the crowd erupting, a comeback, commentary peaks',
  custom: 'hooks, emotional peaks, punchlines, insights, complete thoughts',
}
const focus = (t: string) => FOCUS[t] ?? FOCUS.custom
const lines = (s: z.output<typeof Sentence>[]) => s.map((x) => `[${x.id}] ${x.t}${x.cues.length ? ` (${x.cues.join(', ')})` : ''} ${x.text}`).join('\n')
const taste = (e: z.output<typeof Examples>) => [
  e.kept.length ? `Clips this creator KEPT before, or that got the most real views (more like these):\n- ${e.kept.join('\n- ')}` : '',
  e.deleted.length ? `Clips this creator DELETED before, or that got the fewest real views (avoid these):\n- ${e.deleted.join('\n- ')}` : '',
].filter(Boolean).join('\n\n')

const RULES = 'Pick sentence ids from the transcript only — never invent timestamps. Each clip must be a complete thought that makes sense on its own. ' +
  'The hook sentence must grab attention within the first 3 seconds; the clip will start on it. Cues in parentheses are detected in the audio: ' +
  '(laughter)/(applause)/(cheering) mean the audience reacted right after that sentence; (loud)/(fast) mean raised energy.'

const highlights = task({
  input: z.object({ contentType: z.string().default('custom'), detectType: z.boolean().default(false), tone: z.string().default('neutral'),
    lengthRange: z.tuple([z.number(), z.number()]), sentences: z.array(Sentence).min(1).max(5000), examples: Examples, max: z.number().int().min(1).max(12).default(12) }),
  output: z.object({ contentType: z.enum(TYPES).optional().catch(undefined), candidates: upTo(Candidate, 16) }),
  slots: ['highlight'],
  system: (i) => [
    `You are an expert short-form video editor finding the best ${i.lengthRange[0]}–${i.lengthRange[1]} second clips for TikTok, Reels and Shorts.`,
    i.detectType ? `First decide the content type: one of ${TYPES.join(', ')}. Then look for what works for that type.` : `Content type: ${i.contentType}. Look for: ${focus(i.contentType)}.`,
    i.detectType ? `What works per type: ${Object.entries(FOCUS).map(([k, v]) => `${k}: ${v}`).join('; ')}.` : '',
    `Tone the creator wants: ${i.tone}.`, RULES, `Return up to ${i.max} candidates, best first, that don't overlap much.`, taste(i.examples),
  ].filter(Boolean).join('\n\n'),
  prompt: (i) => `Transcript, one sentence per line as [id] m:ss (cues) text:\n${lines(i.sentences)}`,
})

const ScoreItem = z.object({ key: z.string(), hook: pct, emotion: pct, value: pct, pacing: pct, trend: pct, extra: z.record(z.string(), pct).default({}),
  reasons: z.record(z.string(), txt(160)).default({}), summary: txt(240), tips: upTo(txt(160), 3).default([]) })
export const EXTRAS: Record<string, string[]> = { podcast: ['quotability'], gaming: ['reaction', 'action'], reaction: ['reaction'], sports: ['action'] }

const score = task({
  input: z.object({ contentType: z.string().default('custom'), brief: z.boolean().default(false), clips: z.array(z.object({ key: z.string(), text: z.string().max(6000), cues: z.array(z.string()).default([]) })).min(1).max(16) }),
  output: z.object({ scores: z.array(ScoreItem) }),
  slots: ['scoring', 'highlight'],
  system: (i) => [
    `You rate short-form clips (${i.contentType}) for viral potential. For each clip give 0–100 scores: hook (first 3 seconds), emotion, value (shareability/usefulness), pacing (clarity, no dead air), trend (fit with current short-form trends — your estimate).`,
    EXTRAS[i.contentType] ? `Also score these extra dimensions in "extra": ${EXTRAS[i.contentType].join(', ')}.` : '',
    'Give a short reason per dimension in "reasons" (keys: hook, emotion, value, pacing, trend), a one-line summary of why it would or would not perform, and up to 3 concrete improvement tips. Be honest: most clips are 40–75; reserve 85+ for clips that would clearly stop the scroll. Audio cues (laughter, applause) are real audience reactions.',
    i.brief ? 'Be brief: each reason under 10 words, the summary under 20 words, at most 1 tip. Use the clip numbers exactly as given for "key".' : 'Use the clip numbers exactly as given for "key".',
  ].filter(Boolean).join('\n\n'),
  prompt: (i) => i.clips.map((c) => `Clip ${c.key}${c.cues.length ? ` (audio: ${c.cues.join(', ')})` : ''}:\n${c.text}`).join('\n\n'),
})

const MetaItem = z.object({ key: z.string(), titles: upTo(txt(60), 3).refine((a) => a.length > 0), // not a tuple: Gemini rejects array-form "items"
  descriptions: z.object({ shorts: txt(500), tiktok: txt(500), reels: txt(500) }),
  hashtags: upTo(tag, 10).overwrite((a) => a.filter((h) => h.length > 1).slice(0, 10)),
  // Burned in with the bundled fonts, which have no emoji (libass would draw boxes) — so emoji are stripped.
  hook: z.string().overwrite((s) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 70)).optional().catch(undefined),
  keywords: upTo(txt(40), 6).optional().catch(undefined) })

const metadata = task({
  input: z.object({ contentType: z.string().default('custom'), tone: z.string().default('neutral'), language: z.string().default('en'),
    clips: z.array(z.object({ key: z.string(), text: z.string().max(6000) })).min(1).max(12) }),
  output: z.object({ items: z.array(MetaItem) }),
  slots: ['titles', 'highlight'],
  system: (i) => `You write packaging for short-form clips (${i.contentType}, tone: ${i.tone}) in the transcript's language (${i.language}). For each clip: 3 different hook-style titles under 60 characters (curiosity, no clickbait lies); a description per platform — YouTube Shorts (one clear sentence + call to action), TikTok (casual, 1–2 emoji), Instagram Reels (a hook line, then "save this"-style prompt); 5–10 relevant hashtags starting with #; a "hook": one short line shown on screen over the first 3 seconds to stop the scroll (under 50 characters, no emoji, no hashtags); "keywords": 3–6 single words copied exactly from the clip's transcript that deserve emphasis (the punchline, a surprising fact, a strong emotion).`,
  prompt: (i) => i.clips.map((c) => `Clip ${c.key}:\n${c.text}`).join('\n\n'),
})

const search = task({
  input: z.object({ query: z.string().min(3).max(200), lengthRange: z.tuple([z.number(), z.number()]), sentences: z.array(Sentence).min(1).max(5000) }),
  output: z.object({ matches: upTo(Candidate.omit({ kind: true }), 3) }),
  slots: ['highlight'],
  system: (i) => `Find the moments in this transcript that match the request: "${i.query}". Return up to 3 clips of ${i.lengthRange[0]}–${i.lengthRange[1]} seconds as sentence id ranges, best match first. ${RULES} If nothing in the transcript matches, return an empty "matches" list — do not return loosely related moments.`,
  prompt: (i) => `Transcript, one sentence per line as [id] m:ss (cues) text:\n${lines(i.sentences)}`,
})

const hinglish = task({
  input: z.object({ words: z.array(z.string().max(100)).min(1).max(400) }),
  output: z.object({ words: z.array(z.string()) }),
  slots: ['titles', 'highlight'],
  // Prompt carried over from the original engine/ (romanise Hindi only, keep English, 1:1 words so timestamps line up).
  system: () => `You convert Hindi speech transcripts into Hinglish captions — Hindi written in casual Roman/English script the way people text it, keeping any English words that were already spoken as-is (natural code-switching). Do not translate meaning to English — only romanize the Hindi parts.
The output "words" array MUST have exactly the same length as the input, in the same order — one Hinglish word per input word, so timestamps still line up.`,
  prompt: (i) => JSON.stringify({ words: i.words }),
})

export const LLM_TASKS = { hinglish, highlights, score, metadata, search } as const
export type LlmTaskName = keyof typeof LLM_TASKS
/** Tasks that never call a model. */
export const FREE_TASKS = ['info', 'unload'] as const
