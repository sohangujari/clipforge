'use client'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toEdit, type ClipEdit } from '@/lib/clip-edit'
import type { EditorState } from '@/lib/editor'
import type { Keyframe } from '@/lib/reframe'
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
import type { PanelProps } from './panels/types'

const PANELS: Record<SectionId, (p: PanelProps) => React.ReactNode> = {
  clips: ClipsPanel, layout: LayoutPanel, subtitles: SubtitlesPanel, branding: BrandingPanel, ai: AiPanel, export: ExportPanel, settings: SettingsPanel,
}

export interface RealClip { proxyUrl: string; trackUrl: string; edit?: ClipEdit }
type Props = { project: MockProject; clip: MockClip; clips: MockClip[]; real?: RealClip }
type Loaded = { state: EditorState; track: Keyframe[]; settingsBrand: EditorState['brand'] }


/** Loads saved brand kit + default subtitle preset, then mounts the editor with them as the first undo state. */
export function EditorShell(props: Props) {
  const [initial, setInitial] = useState<Loaded | null>(null)
  useEffect(() => {
    const track: Promise<Keyframe[]> = props.real
      ? fetch(props.real.trackUrl).then((r) => (r.ok ? r.json() : { keyframes: [[0, 0.5, 0.5]] })).then((j) => j.keyframes).catch(() => [[0, 0.5, 0.5]])
      : Promise.resolve([[0, 0.5, 0.5]])
    Promise.all([fetch('/api/settings/brandKit').then((r) => r.json()), fetch('/api/settings/subtitlePresets').then((r) => r.json())])
      .catch(() => [undefined, undefined])
      .then(async ([brand, presets]) => {
        const all: SubtitleStyle[] = [...builtinPresets, ...(presets?.custom ?? [])]
        const e = props.real?.edit
        const base: EditorState = {
          aspect: '9:16',
          layoutId: props.real ? 'single' : layoutsFor(props.project.contentType)[0]?.id ?? 'single',
          style: all.find((p) => p.id === presets?.defaultId) ?? builtinPresets[0],
          subtitlesOn: true, watermarkOn: true,
          brand: brand ?? { position: 'br', opacity: 80, sizePct: 12, marginPct: 4 },
          trim: { start: props.clip.startSec, end: props.clip.endSec },
          words: props.clip.transcript, safeZone: 'off', resolution: '1080p',
        }
        setInitial({ state: e ? { ...base, ...e } : base, track: await track, settingsBrand: base.brand })
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
        {initial ? <Editor key={props.clip.id} {...props} initial={initial.state} track={initial.track} settingsBrand={initial.settingsBrand} /> : <div className="m-auto size-8 animate-spin rounded-full border-2 border-muted border-t-cf-accent" />}
      </div>
    </>
  )
}

function Editor({ project, clip, clips, initial, real, track, settingsBrand }: Props & { initial: EditorState; track: Keyframe[]; settingsBrand: EditorState['brand'] }) {
  const [h, dispatch] = useReducer(historyReducer<EditorState>, initial, initHistory)
  const [section, setSection] = useState<SectionId>('subtitles')
  const [t, setT] = useState(initial.trim.start)
  const [playing, setPlaying] = useState(false)
  const state = h.present
  const set = useCallback((patch: Partial<EditorState>) => dispatch({ type: 'set', value: { ...h.present, ...patch } }), [h.present])
  const videoRef = useRef<HTMLVideoElement>(null)
  const saveEdit = useCallback(async (s: EditorState) => {
    if (!real) return
    // keepalive: the last change still saves when you leave the editor or close the tab right after making it
    const r = await fetch(`/api/clips/${clip.id}`, { method: 'PATCH', keepalive: true, body: JSON.stringify({ edit: toEdit(s, settingsBrand) }) })
    if (!r.ok) toast.error("Couldn't save your changes to this clip")
  }, [real, clip.id, settingsBrand])
  const flushEdit = useAutosave(state, saveEdit)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable=true]') || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const media = real ? { src: real.proxyUrl, track, playing, onTime: setT, videoRef } : undefined
  // Real clips: no second preview in the side panel (a second video + libass instance is too heavy for 8 GB).
  const frame = (cls: string, testIds = true) => (real && !testIds ? null
    : <CanvasFrame state={state} t={t} thumbnail={project.thumbnail} className={cls} testIds={testIds} real={media} />)
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
          <Timeline trim={state.trim} view={view} words={state.words} t={t} onSeek={setT} onTrim={(trim) => set({ trim })} />
        </main>
        <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l bg-cf-panel">
          <h2 className="sticky top-0 z-10 bg-cf-panel/95 px-5 pb-3 pt-5 text-lg font-bold backdrop-blur">{SECTIONS.find((s) => s.id === section)?.label}</h2>
          <div className="px-5 pb-8">
            <Panel state={state} set={set} project={project} clip={clip} clips={clips} preview={frame('w-36', false)} real={!!real} saveEdit={async () => { await flushEdit(); await saveEdit(state) }} />
          </div>
        </aside>
        <Rail value={section} onChange={setSection} />
      </div>
    </div>
  )
}
