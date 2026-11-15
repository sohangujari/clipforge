'use client'
import { useCallback, useEffect, useReducer, useState } from 'react'
import Link from 'next/link'
import { Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EditorState } from '@/lib/editor'
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

type Props = { project: MockProject; clip: MockClip; clips: MockClip[] }

/** Loads saved brand kit + default subtitle preset, then mounts the editor with them as the first undo state. */
export function EditorShell(props: Props) {
  const [initial, setInitial] = useState<EditorState | null>(null)
  useEffect(() => {
    Promise.all([fetch('/api/settings/brandKit').then((r) => r.json()), fetch('/api/settings/subtitlePresets').then((r) => r.json())])
      .catch(() => [undefined, undefined])
      .then(([brand, presets]) => {
        const all: SubtitleStyle[] = [...builtinPresets, ...(presets?.custom ?? [])]
        setInitial({
          aspect: '9:16',
          layoutId: layoutsFor(props.project.contentType)[0]?.id ?? 'single',
          style: all.find((p) => p.id === presets?.defaultId) ?? builtinPresets[0],
          subtitlesOn: true, watermarkOn: true,
          brand: brand ?? { position: 'br', opacity: 80, sizePct: 12, marginPct: 4 },
          trim: { start: props.clip.startSec, end: props.clip.endSec },
          words: props.clip.transcript, safeZone: 'off', resolution: '1080p',
        })
      })
  }, [props.clip, props.project.contentType])

  return (
    <>
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center lg:hidden">
        <Monitor className="size-8 text-muted-foreground" />
        <p className="font-semibold">Open the editor on a larger screen</p>
        <p className="max-w-xs text-sm text-muted-foreground">On a phone you can still review clips, copy titles and download.</p>
        <Button asChild><Link href={`/projects/${props.project.id}/clips`}>Back to clips</Link></Button>
      </div>
      <div className="hidden h-dvh lg:flex">
        {initial ? <Editor key={props.clip.id} {...props} initial={initial} /> : <div className="m-auto size-8 animate-spin rounded-full border-2 border-muted border-t-cf-accent" />}
      </div>
    </>
  )
}

function Editor({ project, clip, clips, initial }: Props & { initial: EditorState }) {
  const [h, dispatch] = useReducer(historyReducer<EditorState>, initial, initHistory)
  const [section, setSection] = useState<SectionId>('subtitles')
  const [t, setT] = useState(initial.trim.start)
  const [playing, setPlaying] = useState(false)
  const state = h.present
  const set = useCallback((patch: Partial<EditorState>) => dispatch({ type: 'set', value: { ...h.present, ...patch } }), [h.present])

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
    if (!playing) return
    let raf = 0, last = performance.now()
    const step = (now: number) => {
      setT((cur) => { const n = cur + (now - last) / 1000; return n >= state.trim.end ? state.trim.start : n })
      last = now; raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, state.trim.start, state.trim.end])

  const frame = (cls: string, testIds = true) => <CanvasFrame state={state} t={t} thumbnail={project.thumbnail} className={cls} testIds={testIds} />
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
            <Panel state={state} set={set} project={project} clip={clip} clips={clips} preview={frame('w-36', false)} />
          </div>
        </aside>
        <Rail value={section} onChange={setSection} />
      </div>
    </div>
  )
}
