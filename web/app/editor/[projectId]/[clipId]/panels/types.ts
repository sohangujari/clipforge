import type { EditorState } from '@/lib/editor'
import type { MockClip, MockProject } from '@/lib/mock'
import type { People } from '@/lib/people'
import type { Range } from '@/lib/cuts'
import type { Speaker } from '@/lib/speakers'

export interface PanelProps {
  state: EditorState
  set: (patch: Partial<EditorState>) => void
  project: MockProject
  clip: MockClip
  clips: MockClip[]
  preview: React.ReactNode
  /** A real clip (not Phase 1 mock data): only layouts the export can render are enabled. */
  real?: boolean
  /** Saves the current edit now (before an export, so it renders exactly what the preview shows). */
  saveEdit?: () => Promise<void>
  /** Speakers found in the video (null: none yet, or not a real clip). */
  people?: People | null
  /** playhead (source seconds) and moving it */
  t: number
  seek: (t: number) => void
  /** what plays after the auto edits and hand cuts */
  keep: Range[]
  /** the camera shot under the playhead (real clips) */
  shot: [number, number] | null
  speakers: Speaker[]
  /** the preview's video (real clips): the facecam/HUD picker draws its frame */
  videoRef?: React.RefObject<HTMLVideoElement | null>
  setSpeakers: (s: Speaker[]) => void
}
