import type { ClipCandidate, Job, SubtitleStylePreset } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

export const api = {
  // Jobs
  listJobs: () => request<Job[]>("/jobs"),
  getJob: (jobId: string) => request<Job>(`/jobs/${jobId}`),
  createJob: (youtubeUrl: string) =>
    request<Job>("/jobs", {
      method: "POST",
      body: JSON.stringify({ youtube_url: youtubeUrl }),
    }),

  // Clips
  listClips: (jobId: string) => request<ClipCandidate[]>(`/jobs/${jobId}/clips`),
  updateClip: (jobId: string, clipId: string, patch: Partial<ClipCandidate>) =>
    request<ClipCandidate>(`/jobs/${jobId}/clips/${clipId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // Metadata
  generateMetadata: (jobId: string, clipId: string) =>
    request<ClipCandidate>(`/jobs/${jobId}/clips/${clipId}/metadata`, {
      method: "POST",
    }),

  // Render
  startRender: (jobId: string, clipId: string, stylePresetId: string, overrides?: Record<string, any>) =>
    request<{ status: string; clip_id: string }>(`/jobs/${jobId}/render`, {
      method: "POST",
      body: JSON.stringify({ clip_id: clipId, style_preset_id: stylePresetId, ...overrides }),
    }),

  // Download — returns a download URL (not JSON)
  getDownloadUrl: (jobId: string, clipId: string) =>
    `${API_URL}/jobs/${jobId}/clips/${clipId}/download`,
    
  // Stream — returns a streaming URL for video playback
  getStreamUrl: (jobId: string, clipId: string) =>
    `${API_URL}/jobs/${jobId}/clips/${clipId}/stream`,

  // Presets
  listPresets: () => request<SubtitleStylePreset[]>("/presets"),
  createPreset: (preset: SubtitleStylePreset) =>
    request<SubtitleStylePreset>("/presets", {
      method: "POST",
      body: JSON.stringify(preset),
    }),
  deletePreset: (presetId: string) =>
    request<{ deleted: string }>(`/presets/${presetId}`, {
      method: "DELETE",
    }),
};
