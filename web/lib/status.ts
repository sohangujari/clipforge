import type { JobStatus } from "@/lib/types";

export function statusLabel(status: JobStatus): string {
  const labels: Record<JobStatus, string> = {
    queued: "Queued",
    downloading: "Downloading",
    transcribing: "Transcribing",
    analyzing: "Analyzing",
    ready_for_review: "Ready for review",
    rendering: "Rendering",
    done: "Done",
    failed: "Failed",
  };
  return labels[status];
}

export function statusVariant(
  status: JobStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "done" || status === "ready_for_review") return "default";
  return "secondary";
}

export function progressMessage(status: JobStatus): string {
  const messages: Partial<Record<JobStatus, string>> = {
    queued: "Waiting to start...",
    downloading: "Downloading video...",
    transcribing: "Transcribing audio - this can take a while on CPU...",
    analyzing: "Finding clip-worthy moments...",
    rendering: "Rendering clip...",
  };
  return messages[status] ?? "Working...";
}