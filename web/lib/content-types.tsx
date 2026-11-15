import { Clapperboard, Gamepad2, MonitorPlay, Mic, SlidersHorizontal, Trophy, Video, Wand2 } from 'lucide-react'
import type { ContentType } from './layouts'

export const CONTENT_TYPE_INFO: { value: ContentType; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: 'auto', label: 'Auto-detect', hint: 'AI picks the type', icon: <Wand2 /> },
  { value: 'podcast', label: 'Podcast / Interview', hint: 'Speakers, split screens', icon: <Mic /> },
  { value: 'gaming', label: 'Gaming / Stream', hint: 'Facecam + gameplay', icon: <Gamepad2 /> },
  { value: 'vlog', label: 'Talking head / Vlog', hint: 'Face-tracked, punch-ins', icon: <Video /> },
  { value: 'tutorial', label: 'Tutorial / Screen', hint: 'Zoom to cursor', icon: <MonitorPlay /> },
  { value: 'reaction', label: 'Reaction', hint: 'Reactor + content stack', icon: <Clapperboard /> },
  { value: 'sports', label: 'Sports', hint: 'Follow the action', icon: <Trophy /> },
  { value: 'custom', label: 'Custom', hint: 'Set everything yourself', icon: <SlidersHorizontal /> },
]
