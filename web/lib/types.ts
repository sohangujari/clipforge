// Mirrors engine/app/models/schemas.py by hand. Keep in sync manually -
// not worth codegen tooling at this scale.

export type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "ready_for_review"
  | "rendering"
  | "done"
  | "failed";

export interface Job {
  id: string;
  youtube_url: string;
  status: JobStatus;
  progress?: number;
  error?: string | null;
  source_language?: string | null;
  source_title?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface ClipCandidate {
  id: string;
  job_id: string;
  start: number;
  end: number;
  hook_score: number;
  reason: string;
  transcript_words: WordTiming[];
  hinglish_words?: WordTiming[] | null;
  title?: string | null;
  description?: string | null;
  tags: string[];
  style_preset_id?: string | null;
  rendered_path?: string | null;
  render_progress?: number;
}

export interface SubtitleStylePreset {
  id: string;
  name: string;
  font_family: string;
  font_size: number;
  primary_color: string;
  highlight_color: string;
  outline_color: string;
  outline_width: number;
  bg_color?: string | null;
  border_style?: number;
  position: "auto" | "bottom" | "center" | "top" | "none";
  animation: "pop" | "fade" | "bounce" | "none";
  words_per_group: number;
}
