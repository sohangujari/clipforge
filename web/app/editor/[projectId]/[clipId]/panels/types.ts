import type { EditorState } from '@/lib/editor'
import type { MockClip, MockProject } from '@/lib/mock'

export interface PanelProps {
  state: EditorState
  set: (patch: Partial<EditorState>) => void
  project: MockProject
  clip: MockClip
  clips: MockClip[]
  preview: React.ReactNode
}
