"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

import { api } from "@/lib/api";
import { statusLabel, statusVariant, progressMessage } from "@/lib/status";
import type { Job } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const IN_PROGRESS: Job["status"][] = [
  "queued",
  "downloading",
  "transcribing",
  "analyzing",
  "rendering",
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await api.listJobs();
      setJobs(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach the engine");
    }
  }, []);

  useEffect(() => {
    refreshJobs();
    const interval = setInterval(refreshJobs, 3000);
    return () => clearInterval(interval);
  }, [refreshJobs]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createJob(url.trim());
      setUrl("");
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit job");
    } finally {
      setSubmitting(false);
    }
  }

  const activeJobs = jobs.filter((j) => IN_PROGRESS.includes(j.status));
  const completedJobs = jobs.filter((j) => !IN_PROGRESS.includes(j.status));

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      {/* Hero */}
      <div className="text-center mb-12 animate-in">
        <h1 className="text-4xl font-extrabold gradient-text tracking-tight">
          ClipForge
        </h1>
        <p className="mt-3 text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
          Paste a YouTube link. Get vertical clips with burned-in captions,
          face-tracked cropping, and SEO-ready metadata — all local.
        </p>
      </div>

      {/* URL Input */}
      <form
        onSubmit={handleSubmit}
        className="animate-in delay-1 glass-card rounded-2xl p-6"
      >
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <Input
              id="youtube-url"
              placeholder="https://youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting}
              className="pl-10 h-12 bg-secondary/50 border-border/50 text-base"
            />
          </div>
          <Button
            type="submit"
            disabled={submitting || !url.trim()}
            className="h-12 px-6 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing
              </span>
            ) : (
              "Generate clips"
            )}
          </Button>
        </div>
      </form>

      {error && (
        <div className="mt-4 animate-in p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">
            {error} — is the engine running on localhost:8000?
          </p>
        </div>
      )}

      {/* Active Jobs */}
      {activeJobs.length > 0 && (
        <div className="mt-10 animate-in delay-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            In Progress
          </h2>
          <div className="space-y-3">
            {activeJobs.map((job, i) => (
              <Link key={job.id} href={`/jobs/${job.id}`}>
                <div className={`glass-card rounded-xl p-5 animate-in delay-${i + 1}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">
                        {job.source_title ?? job.youtube_url}
                      </p>
                      <p className="text-sm text-muted-foreground truncate mt-1">
                        {job.youtube_url}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="status-dot active" style={{
                        backgroundColor: "oklch(0.7 0.18 300)",
                        boxShadow: "0 0 8px oklch(0.7 0.18 300 / 60%)"
                      }} />
                      <Badge variant={statusVariant(job.status)}>
                        {statusLabel(job.status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="progress-bar">
                      <div
                        className="fill"
                        style={{ width: job.progress != null ? `${job.progress}%` : progressWidth(job.status) }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {progressMessage(job.status)}
                      {job.progress != null && (
                        <span className="text-foreground/80 font-medium ml-1">({job.progress}%)</span>
                      )}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Completed / Failed Jobs */}
      {completedJobs.length > 0 && (
        <div className="mt-10 animate-in delay-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Completed
          </h2>
          <div className="space-y-3">
            {completedJobs.map((job, i) => (
              <Link key={job.id} href={`/jobs/${job.id}`}>
                <div className={`glass-card rounded-xl p-5 animate-in delay-${Math.min(i + 1, 5)}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">
                        {job.source_title ?? job.youtube_url}
                      </p>
                      <p className="text-sm text-muted-foreground truncate mt-1">
                        {job.youtube_url}
                      </p>
                    </div>
                    <Badge variant={statusVariant(job.status)}>
                      {statusLabel(job.status)}
                    </Badge>
                  </div>
                  {job.status === "failed" && job.error && (
                    <p className="mt-2 text-sm text-destructive/80 line-clamp-2">
                      {job.error}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {jobs.length === 0 && !error && (
        <div className="mt-16 text-center animate-in delay-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary/50 mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <p className="text-muted-foreground">
            No jobs yet. Paste a YouTube URL above to get started.
          </p>
        </div>
      )}
    </main>
  );
}

function progressWidth(status: Job["status"]): string {
  const map: Record<string, string> = {
    queued: "5%",
    downloading: "25%",
    transcribing: "50%",
    analyzing: "75%",
    rendering: "90%",
    ready_for_review: "100%",
    done: "100%",
    failed: "100%",
  };
  return map[status] ?? "0%";
}
