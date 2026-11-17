'use client'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { derive, toEdit, type ClipEdit, type ClipMedia } from '@/lib/clip-edit'
import type { Range } from '@/lib/cuts'
import { shotAt, withFocus, type EditorState } from '@/lib/editor'
import type { Keyframe } from '@/lib/reframe'
import { defaultLayout, type People } from '@/lib/people'
import { speakerList, type Speaker } from '@/lib/speakers'
import { useAutosave } from '@/lib/use-autosave'
import { historyReducer, initHistory } from '@/lib/history'
import { layoutsFor } from '@/lib/layouts'
import type { MockClip, MockProject } from '@/lib/mock'
import { builtinPresets, type SubtitleStyle } from '@/lib/subtitle-presets'
import { CanvasFrame } from './Canvas'
import { Rail, SECTIONS, type SectionId } from './Rail'
import { Timeline } from './Timeline'
import { Toolbar } from './Toolbar'
import { AiPanel } from './panels/AiPanel'
import { BrandingPanel } from './panels/BrandingPanel'
import { ClipsPanel } from './panels/ClipsPanel'
import { ExportPanel } from './panels/ExportPanel'
import { LayoutPanel } from './panels/LayoutPanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { SubtitlesPanel } from './panels/SubtitlesPanel'
import { TranscriptPanel } from './panels/TranscriptPanel'
import type { PanelProps } from './panels/types'

const PANELS: Record<SectionId, (p: PanelProps) => React.ReactNode> = {
  clips: ClipsPanel, transcript: TranscriptPanel, layout: LayoutPanel, subtitles: SubtitlesPanel, branding: BrandingPanel, ai: AiPanel, export: ExportPanel, settings: SettingsPanel,
}

export interface RealClip { proxyUrl: string; trackUrl: string; peopleUrl: string; edit?: ClipEdit; silences: Range[]; keywords: string[]; hook?: string
  cuts: number[]; duration: number; speakers: Speaker[] | null }
type Props = { project: MockProject; clip: MockClip; clips: MockClip[]; real?: RealClip }
type Track = { keyframes: Keyframe[]; wide: Range[]; fps: number }
type Loaded = { state: EditorState; track: Track; settingsBrand: EditorState['brand']; people: People | null }


/** Loads saved brand kit + default subtitle preset, then mounts the editor with them as the first undo state. */
export function EditorShell(props: Props) {
  const [initial, setInitial] = useState<Loaded | null>(null)
  useEffect(() => {
    const none: Track = { keyframes: [[0, 0.5, 0.5]], wide: [], fps: 30 }
    const track: Promise<Track> = props.real
      ? fetch(props.real.trackUrl).then((r) => (r.ok ? r.json() : none)).then((j) => ({ keyframes: j.keyframes, wide: j.wide ?? [], fps: j.fps ?? 30 })).catch(() => none)
      : Promise.resolve(none)
    const people: Promise<People | null> = props.real ? fetch(props.real.peopleUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null)
    Promise.all([fetch('/api/settings/brandKit').then((r) => r.json()), fetch('/api/settings/subtitlePresets').then((r) => r.json())])
      .catch(() => [undefined, undefined])
      .then(async ([brand, presets]) => {
        const all: SubtitleStyle[] = [...builtinPresets, ...(presets?.custom ?? [])]
        const e = props.real?.edit
        const base: EditorState = {
          aspect: '9:16',
          layoutId: props.real ? defaultLayout(await people) : layoutsFor(props.project.contentType)[0]?.id ?? 'single',
          style: all.find((p) => p.id === presets?.defaultId) ?? builtinPresets[0],
          subtitlesOn: true, watermarkOn: true,
          brand: brand ?? { position: 'br', opacity: 80, sizePct: 12, marginPct: 4 },
          trim: { start: props.clip.startSec, end: props.clip.endSec },
          words: props.clip.transcript, safeZone: 'off', resolution: '1080p',
          // Phase 4b: on by default — clips come out tight and punchy without hand editing (same defaults as lib/exports.ts)
          removeFillers: true, removePauses: true, autoZoom: true, bumpers: true,
          hook: { on: false, text: props.real?.hook ?? props.clip.titles[0] ?? '' },
          cuts: [], focus: [], speakerColors: false,
        }
        const saved: Partial<ClipEdit> = { ...e }
        delete saved.keep; delete saved.zooms // derived from the switches; worked out again here
        setInitial({ state: { ...base, ...saved } as EditorState, track: await track, settingsBrand: base.brand, people: await people })
      })
  }, [props.clip, props.project.contentType, props.real])

  return (
    <>
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center lg:hidden">
        <Monitor className="size-8 text-muted-foreground" />
        <p className="font-semibold">Open the editor on a larger screen</p>
        <p className="max-w-xs text-sm text-muted-foreground">On a phone you can still review clips, copy titles and download.</p>
        <Button asChild><Link href={`/projects/${props.project.id}/clips`}>Back to clips</Link></Button>
      </div>
      <div className="hidden h-dvh lg:flex">
        {initial ? <Editor key={props.clip.id} {...props} initial={initial.state} track={initial.track} settingsBrand={initial.settingsBrand} people={initial.people} /> : <div className="m-auto size-8 animate-spin rounded-full border-2 border-muted border-t-cf-accent" />}
      </div>
    </>
  )
}

function Editor({ project, clip, clips, initial, real, track, settingsBrand, people }: Props & { initial: EditorState; track: Track; settingsBrand: EditorState['brand']; people: People | null }) {
  const [h, dispatch] = useReducer(historyReducer<EditorState>, initial, initHistory)
  const [section, setSection] = useState<SectionId>('transcript')
  const [t, setT] = useState(initial.trim.start)
  const [playing, setPlaying] = useState(false)
  const state = h.present
  const set = useCallback((patch: Partial<EditorState>) => dispatch({ type: 'set', value: { ...h.present, ...patch } }), [h.present])
  const videoRef = useRef<HTMLVideoElement>(null)
  const media: ClipMedia = useMemo(() => ({ silences: real?.silences ?? [], keywords: real?.keywords ?? [] }), [real])
  const cuts = useMemo(() => derive(state, media), [state, media])
  const saveEdit = useCallback(async (s: EditorState) => {
    if (!real) return
    // keepalive: the last change still saves when you leave the editor or close the tab right after making it
    const r = await fetch(`/api/clips/${clip.id}`, { method: 'PATCH', keepalive: true, body: JSON.stringify({ edit: toEdit(s, settingsBrand, media) }) })
    if (!r.ok) toast.error("Couldn't save your changes to this clip")
  }, [real, clip.id, settingsBrand, media])
  const flushEdit = useAutosave(state, saveEdit)
  const frameS = 1 / track.fps // one frame, for the nudges and ←/→

  // Speaker names/colours belong to the video, not the clip: saved on the project, outside undo.
  const count = Math.max(people?.speakers.length ?? 0, ...state.words.map((w) => (w.speaker ?? -1) + 1))
  const [saved, setSaved] = useState<Speaker[] | null>(real?.speakers ?? null)
  const speakers = useMemo(() => speakerList(saved, Math.max(count, saved?.length ?? 0)), [saved, count])
  useAutosave(saved, useCallback(async (v: Speaker[] | null) => {
    if (!real || !v) return
    const r = await fetch(`/api/projects/${project.id}`, { method: 'PATCH', keepalive: true, body: JSON.stringify({ speakers: v.map((x, i) => ({ ...x, name: x.name.trim() || `Speaker ${i + 1}` })) }) })
    if (!r.ok) toast.error("Couldn't save the speaker names")
  }, [real, project.id]))
  const speakerColors = useMemo(() => speakerList(saved, Math.max(saved?.length ?? 0, 4)).map((x) => x.color), [saved]) // as the export (render.py)
  const shot = real ? shotAt(real.cuts, real.duration, t) : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable=true]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); return }
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('[role=slider], [role=listbox], [role=menu]')) return
      if (e.key === ' ' && !el.closest('button, a, [role=switch], [role=radio]')) { e.preventDefault(); setPlaying((p) => !p) }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { // one frame (shift: one second), paused
        e.preventDefault(); setPlaying(false)
        setT((cur) => Math.max(0, Math.round((cur + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : frameS)) * 1000) / 1000))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [frameS])

  useEffect(() => {
    if (!playing || real) return // real clips: the video is the clock
    let raf = 0, last = performance.now()
    const step = (now: number) => {
      setT((cur) => { const n = cur + (now - last) / 1000; return n >= state.trim.end ? state.trim.start : n })
      last = now; raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, real, state.trim.start, state.trim.end])

  const video = real ? { src: real.proxyUrl, track: track.keyframes, wide: track.wide, people, playing, onTime: setT, videoRef, ...cuts,
    speakerColors, shotAt: (at: number) => shotAt(real.cuts, real.duration, at),
    onFocus: (sh: [number, number], x: number, y: number) => set({ focus: withFocus(state.focus, sh, x, y) }) } : undefined
  // Real clips: no second preview in the side panel (a second video + libass instance is too heavy for 8 GB).
  const frame = (cls: string, testIds = true) => (real && !testIds ? null
    : <CanvasFrame state={state} t={t} thumbnail={project.thumbnail} className={cls} testIds={testIds} real={video} />)
  const Panel = PANELS[section]
  const view = { start: Math.max(0, clip.startSec - 30), end: Math.min(project.durationSec, clip.endSec + 30) }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Toolbar title={clip.titles[0]} backHref={`/projects/${project.id}/clips`} aspect={state.aspect} onAspect={(aspect) => set({ aspect })}
        canUndo={h.past.length > 0} canRedo={h.future.length > 0} onUndo={() => dispatch({ type: 'undo' })} onRedo={() => dispatch({ type: 'redo' })}
        playing={playing} onPlay={() => setPlaying((p) => !p)} onExport={() => setSection('export')} />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-4 bg-dotgrid p-6">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {frame(state.aspect === '16:9' ? 'w-full max-w-3xl' : 'h-full max-h-[calc(100dvh-14rem)]')}
          </div>
          <Timeline trim={state.trim} keep={real ? cuts.keep : undefined} view={view} words={state.words} t={t} frame={frameS} speakers={speakers}
            onSeek={(at) => { setPlaying(false); setT(at) }} onTrim={(trim) => set({ trim })} />
        </main>
        <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l bg-cf-panel">
          <h2 className="sticky top-0 z-10 bg-cf-panel/95 px-5 pb-3 pt-5 text-lg font-bold backdrop-blur">{SECTIONS.find((s) => s.id === section)?.label}</h2>
          <div className="px-5 pb-8">
            <Panel state={state} set={set} project={project} clip={clip} clips={clips} preview={frame('w-36', false)} real={!!real} people={people} saveEdit={async () => { await flushEdit(); await saveEdit(state) }}
              t={t} seek={(at) => { setPlaying(false); setT(at) }} keep={cuts.keep} shot={shot} speakers={speakers} setSpeakers={setSaved} />
          </div>
        </aside>
        <Rail value={section} onChange={setSection} />
      </div>
    </div>
  )
}
