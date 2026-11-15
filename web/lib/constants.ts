// Client-safe constants shared by settings schemas and UI.
export const POSITIONS = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br'] as const
export const CONTENT_TYPES = ['auto', 'podcast', 'gaming', 'vlog', 'tutorial', 'reaction', 'sports', 'custom'] as const
export const TONES = ['educational', 'funny', 'motivational', 'dramatic', 'neutral'] as const
export const SETTINGS_SECTIONS = [
  ['ai', 'AI providers'], ['brand', 'Brand kit'], ['subtitles', 'Subtitle presets'], ['layouts', 'Layout templates'], ['defaults', 'Defaults'], ['profile', 'Profile'],
] as const
