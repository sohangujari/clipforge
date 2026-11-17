import type { EditorState } from '@/lib/editor'
import type { MockClip, MockProject } from '@/lib/mock'
import type { People } from '@/lib/people'

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
}
