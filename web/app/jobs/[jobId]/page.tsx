"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { api } from "@/lib/api";
import { statusLabel, statusVariant, progressMessage } from "@/lib/status";
import type { ClipCandidate, Job, SubtitleStylePreset } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function JobDetailPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [job, setJob] = useState<Job | null>(null);
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [presets, setPresets] = useState<SubtitleStylePreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedPresets, setSelectedPresets] = useState<Record<string, string>>({});
  const [loadingMeta, setLoadingMeta] = useState<Record<string, boolean>>({});
  const [loadingRender, setLoadingRender] = useState<Record<string, boolean>>({});
  const [expandedClip, setExpandedClip] = useState<string | null>(null);
  const [expandedAdvanced, setExpandedAdvanced] = useState<Record<string, boolean>>({});
  const [styleOverrides, setStyleOverrides] = useState<
    Record<
      string,
      {
        font_family?: string;
        primary_color?: string;
        highlight_color?: string;
        outline_color?: string;
        bg_color?: string | null;
        border_style?: number;
        position?: string;
      }
    >
  >({});
  const [renderProgress, setRenderProgress] = useState<Record<string, number>>({});
  const [karaokeStep, setKaraokeStep] = useState(0);

  // Live animation ticker for Instagram preview
  useEffect(() => {
    const timer = setInterval(() => {
      setKaraokeStep((s) => (s + 1) % 4);
    }, 700);
    return () => clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [jobData, clipsData, presetsData] = await Promise.all([
        api.getJob(jobId),
        api.listClips(jobId).catch(() => []),
        api.listPresets().catch(() => []),
      ]);
      setJob(jobData);
      setClips(clipsData);
      setPresets(presetsData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load job");
    }
  }, [jobId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Initialize default preset selection
  useEffect(() => {
    if (presets.length > 0 && clips.length > 0) {
      const defaults: Record<string, string> = {};
      clips.forEach((c) => {
        if (!selectedPresets[c.id]) {
          defaults[c.id] = c.style_preset_id ?? presets[0].id;
        }
      });
      if (Object.keys(defaults).length > 0) {
        setSelectedPresets((prev) => ({ ...defaults, ...prev }));
      }
    }
  }, [presets, clips]);

  async function handleGenerateMetadata(clipId: string) {
    setLoadingMeta((p) => ({ ...p, [clipId]: true }));
    try {
      await api.generateMetadata(jobId, clipId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Metadata generation failed");
    } finally {
      setLoadingMeta((p) => ({ ...p, [clipId]: false }));
    }
  }

  async function handleRender(clipId: string) {
    const presetId = selectedPresets[clipId] ?? presets[0]?.id;
    if (!presetId) return;
    setLoadingRender((p) => ({ ...p, [clipId]: true }));
    try {
      await api.startRender(jobId, clipId, presetId, styleOverrides[clipId]);
      // Poll more frequently during render
      const poll = setInterval(async () => {
        const updated = await api.listClips(jobId).catch(() => []);
        const clip = updated.find((c) => c.id === clipId);
        if (clip) {
          if (clip.render_progress != null) {
            setRenderProgress((p) => ({ ...p, [clip.id]: clip.render_progress! }));
          }
          if (clip.rendered_path) {
            clearInterval(poll);
            setLoadingRender((p) => ({ ...p, [clipId]: false }));
            setRenderProgress((p) => ({ ...p, [clipId]: 100 }));
            await refresh();
          }
        }
      }, 250);
      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(poll);
        setLoadingRender((p) => ({ ...p, [clipId]: false }));
      }, 300000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render failed");
      setLoadingRender((p) => ({ ...p, [clipId]: false }));
    }
  }

  async function handleUpdateField(
    clipId: string,
    field: string,
    value: string | string[]
  ) {
    try {
      await api.updateClip(jobId, clipId, { [field]: value } as Partial<ClipCandidate>);
    } catch (e) {
      console.error("Failed to update clip:", e);
    }
  }

  const isProcessing =
    job &&
    ["queued", "downloading", "transcribing", "analyzing", "rendering"].includes(
      job.status
    );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
        </svg>
        All jobs
      </Link>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {job && (
        <>
          {/* Job header */}
          <div className="mt-6 animate-in">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold truncate gradient-text">
                  {job.source_title ?? "Processing..."}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground truncate">
                  {job.youtube_url}
                </p>
              </div>
              <Badge variant={statusVariant(job.status)} className="shrink-0 mt-1">
                {statusLabel(job.status)}
              </Badge>
            </div>

            {job.source_language && (
              <p className="mt-2 text-xs text-muted-foreground">
                Language: <span className="font-medium text-foreground/80">{job.source_language.toUpperCase()}</span>
              </p>
            )}

            {job.status === "failed" && job.error && (
              <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{job.error}</p>
              </div>
            )}
          </div>

          {/* Progress indicator for processing jobs */}
          {isProcessing && (
            <div className="mt-6 glass-card rounded-xl p-5 animate-in delay-1">
              <div className="flex items-center gap-3">
                <span
                  className="status-dot active"
                  style={{
                    backgroundColor: "oklch(0.7 0.18 300)",
                    boxShadow: "0 0 8px oklch(0.7 0.18 300 / 60%)",
                  }}
                />
                <span className="text-sm font-medium">
                  {progressMessage(job.status)}
                  {job.progress !== undefined && job.progress !== null && (
                    <span className="text-muted-foreground ml-1">({job.progress}%)</span>
                  )}
                </span>
              </div>
              <div className="mt-3 progress-bar">
                <div className="fill" style={{ width: job.progress !== undefined && job.progress !== null ? `${job.progress}%` : progressWidth(job.status) }} />
              </div>
            </div>
          )}

          {/* Clips */}
          <div className="mt-8 space-y-4">
            {clips.length === 0 && !isProcessing && job.status !== "failed" && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No clip candidates found.
              </p>
            )}

            {clips
              .slice()
              .sort((a, b) => b.hook_score - a.hook_score)
              .map((clip, idx) => {
                const isExpanded = expandedClip === clip.id;
                const currentPreset = presets.find(
                  (p) => p.id === (selectedPresets[clip.id] ?? presets[0]?.id)
                );

                return (
                  <div
                    key={clip.id}
                    className={`glass-card rounded-xl overflow-hidden animate-in delay-${Math.min(idx + 1, 5)}`}
                  >
                    {/* Clip header */}
                    <button
                      className="w-full p-5 text-left flex items-center gap-4"
                      onClick={() =>
                        setExpandedClip(isExpanded ? null : clip.id)
                      }
                    >
                      {/* Score ring */}
                      <div
                        className="score-ring shrink-0"
                        style={{
                          background: `conic-gradient(oklch(${0.5 + clip.hook_score * 0.3} ${0.1 + clip.hook_score * 0.15} ${300 - clip.hook_score * 80}) ${clip.hook_score * 360}deg, oklch(0.2 0.02 280) 0deg)`,
                        }}
                      >
                        <span className="bg-card rounded-full w-10 h-10 flex items-center justify-center text-xs font-bold">
                          {Math.round(clip.hook_score * 100)}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            {formatTime(clip.start)} – {formatTime(clip.end)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({Math.round(clip.end - clip.start)}s)
                          </span>
                          {clip.rendered_path && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0">
                              Rendered
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                          {clip.reason}
                        </p>
                      </div>

                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`text-muted-foreground transition-transform shrink-0 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-5 pb-5 border-t border-border/30 pt-4 space-y-5">
                        {/* Transcript preview */}
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                            Transcript
                          </h4>
                          <p className="text-sm text-foreground/80 leading-relaxed max-h-24 overflow-y-auto">
                            {(clip.hinglish_words ?? clip.transcript_words)
                              .map((w) => w.word)
                              .join(" ")}
                          </p>
                        </div>

                        {/* Instagram Reels Caption Studio */}
                        <div className="bg-secondary/15 rounded-2xl p-5 border border-border/40 space-y-6">
                          {/* Section Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/30 pb-3">
                            <div>
                              <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                                <span className="text-base">✨</span> Instagram Reels & Shorts Caption Studio
                              </h4>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Google Fonts, animated word pop, and authentic 9:16 frame preview
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] font-medium bg-primary/10 text-primary px-2.5 py-1 rounded-full border border-primary/20">
                              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                              Live Real-time Preview
                            </div>
                          </div>

                          {/* Quick Style Carousel (Instagram Stories Font Bar) */}
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                              Choose Text Style
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                              {presets.map((preset) => {
                                const isSelected = (selectedPresets[clip.id] ?? presets[0]?.id) === preset.id;
                                return (
                                  <button
                                    key={preset.id}
                                    onClick={() =>
                                      setSelectedPresets((p) => ({
                                        ...p,
                                        [clip.id]: preset.id,
                                      }))
                                    }
                                    className={`group relative flex flex-col items-center justify-between p-2.5 rounded-xl border text-center transition-all duration-200 ${
                                      isSelected
                                        ? "border-primary bg-primary/15 ring-2 ring-primary/50 shadow-md shadow-primary/20 scale-[1.02]"
                                        : "border-border/40 bg-secondary/30 hover:bg-secondary/60 hover:border-border/70"
                                    }`}
                                  >
                                    <div className="h-9 flex items-center justify-center w-full my-auto px-1">
                                      {preset.id === "none" ? (
                                        <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                          🚫 None
                                        </span>
                                      ) : preset.border_style === 3 || preset.bg_color === "#FFFFFF" ? (
                                        <span className="bg-white text-black px-2 py-0.5 rounded-md text-[10px] font-black tracking-tight shadow">
                                          <span style={{ color: preset.highlight_color }}>REEL</span> BOX
                                        </span>
                                      ) : preset.bg_color === "#000000" ? (
                                        <span className="bg-black text-white border border-white/20 px-2 py-0.5 rounded-md text-[10px] font-black tracking-tight shadow">
                                          <span style={{ color: preset.highlight_color }}>DARK</span> BOX
                                        </span>
                                      ) : (
                                        <span
                                          className="text-[11px] font-black tracking-wide leading-none"
                                          style={{
                                            fontFamily: preset.font_family,
                                            color: preset.primary_color,
                                            WebkitTextStroke: `${Math.max(0.3, preset.outline_width / 4.5)}px ${preset.outline_color}`,
                                            textShadow: "0 1px 3px rgba(0,0,0,0.8)"
                                          }}
                                        >
                                          <span style={{ color: preset.highlight_color }}>VIRAL </span>
                                          POP
                                        </span>
                                      )}
                                    </div>
                                    <span className={`text-[10px] font-semibold tracking-tight transition-colors ${
                                      isSelected ? "text-primary font-bold" : "text-muted-foreground group-hover:text-foreground"
                                    }`}>
                                      {preset.name}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Dual Pane Studio: 9:16 Smartphone Mockup + Creator Controls */}
                          {currentPreset && currentPreset.id !== "none" && (() => {
                            const previewFont = styleOverrides[clip.id]?.font_family ?? currentPreset.font_family ?? "Montserrat";
                            const previewColor = styleOverrides[clip.id]?.primary_color ?? currentPreset.primary_color ?? "#FFFFFF";
                            const previewHighlight = styleOverrides[clip.id]?.highlight_color ?? currentPreset.highlight_color ?? "#FFE600";
                            const previewPos = styleOverrides[clip.id]?.position ?? currentPreset.position ?? "auto";
                            const hasBoxBg = (styleOverrides[clip.id]?.border_style === 3 || (styleOverrides[clip.id]?.border_style === undefined && currentPreset.border_style === 3));
                            const boxBgColor = styleOverrides[clip.id]?.bg_color ?? currentPreset.bg_color ?? (hasBoxBg ? "#FFFFFF" : null);

                            // Words to demonstrate live in real time
                            const sampleWords = ["THIS", "IS", "HOW", "VIRAL", "CLIPS", "ARE", "MADE"];

                            return (
                              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pt-2">
                                {/* Left Column: Realistic 9:16 Instagram Reel Phone Screen */}
                                <div className="lg:col-span-5 flex flex-col items-center">
                                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <span>📱</span> 9:16 Reel Live Preview
                                  </div>

                                  <div className="phone-mockup-frame relative flex flex-col justify-between p-3.5 select-none">
                                    {/* Notch / Dynamic Island */}
                                    <div className="phone-notch" />
                                    
                                    {/* Phone Status Bar */}
                                    <div className="flex justify-between items-center text-[10px] font-medium text-white/70 px-3 pt-1 z-30">
                                      <span>9:41</span>
                                      <div className="flex items-center gap-1 text-[9px]">
                                        <span>5G</span>
                                        <span>●●●</span>
                                        <span>100%</span>
                                      </div>
                                    </div>

                                    {/* Reel Safe Zone Guidelines */}
                                    <div className="reel-safe-zone flex flex-col justify-between p-2">
                                      <span className="text-[8px] font-mono text-white/20 uppercase">Top Safe Margin</span>
                                      <span className="text-[8px] font-mono text-white/20 uppercase text-right">Bottom Safe Margin</span>
                                    </div>

                                    {/* Right Overlay Action Icons (Instagram Reel UI) */}
                                    <div className="absolute right-2.5 bottom-16 flex flex-col items-center gap-3 z-30">
                                      <div className="flex flex-col items-center">
                                        <div className="w-7 h-7 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-xs">❤️</div>
                                        <span className="text-[8px] font-semibold text-white/80 mt-0.5">142K</span>
                                      </div>
                                      <div className="flex flex-col items-center">
                                        <div className="w-7 h-7 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-xs">💬</div>
                                        <span className="text-[8px] font-semibold text-white/80 mt-0.5">2.4K</span>
                                      </div>
                                      <div className="flex flex-col items-center">
                                        <div className="w-7 h-7 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-xs">↗️</div>
                                        <span className="text-[8px] font-semibold text-white/80 mt-0.5">18K</span>
                                      </div>
                                      <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-pink-500 to-yellow-500 flex items-center justify-center text-[9px] animate-spin">🎵</div>
                                    </div>

                                    {/* Subtitle Rendering Container (Positioned Accurately) */}
                                    <div
                                      className={`w-full flex justify-center z-20 px-2 my-auto transition-all duration-300 ${
                                        previewPos === "top"
                                          ? "pt-12 pb-auto my-0"
                                          : previewPos === "center"
                                          ? "my-auto"
                                          : "pt-auto pb-14 my-0"
                                      }`}
                                    >
                                      {hasBoxBg ? (
                                        <div
                                          className="px-4 py-2 rounded-2xl shadow-2xl transition-all duration-200 text-center"
                                          style={{
                                            backgroundColor: boxBgColor || "#FFFFFF",
                                            fontFamily: previewFont,
                                            color: previewColor,
                                            boxShadow: "0 10px 30px -5px rgba(0,0,0,0.8)",
                                          }}
                                        >
                                          <div className="text-sm font-black tracking-tight leading-snug">
                                            {sampleWords.slice(0, 4).map((w, idx) => {
                                              const isActive = idx === karaokeStep;
                                              return (
                                                <span
                                                  key={idx}
                                                  className={`transition-all duration-150 inline-block mx-0.5 ${isActive ? "scale-110" : ""}`}
                                                  style={{
                                                    color: isActive ? previewHighlight : previewColor,
                                                  }}
                                                >
                                                  {w}
                                                </span>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      ) : (
                                        <div
                                          className="text-center transition-all duration-200"
                                          style={{
                                            fontFamily: previewFont,
                                            color: previewColor,
                                            WebkitTextStroke: `${Math.max(0.5, currentPreset.outline_width / 3.2)}px ${currentPreset.outline_color}`,
                                            textShadow: "0 4px 12px rgba(0,0,0,0.9)",
                                          }}
                                        >
                                          <div className="text-base font-black tracking-wide leading-tight">
                                            {sampleWords.slice(0, 4).map((w, idx) => {
                                              const isActive = idx === karaokeStep;
                                              return (
                                                <span
                                                  key={idx}
                                                  className={`transition-all duration-150 inline-block mx-0.5 ${isActive ? "karaoke-active scale-110" : ""}`}
                                                  style={{
                                                    color: isActive ? previewHighlight : previewColor,
                                                  }}
                                                >
                                                  {w}
                                                </span>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Bottom Instagram Reel Meta */}
                                    <div className="z-20 text-left px-1 pb-1">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold">CF</div>
                                        <span className="text-[10px] font-bold text-white shadow-sm">@clipforge_ai</span>
                                        <span className="text-[8px] bg-white/20 px-1.5 py-0.2 rounded text-white font-medium">Follow</span>
                                      </div>
                                      <p className="text-[9px] text-white/80 line-clamp-1">
                                        {(clip.hinglish_words ?? clip.transcript_words).slice(0, 8).map(w => w.word).join(" ")}...
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                {/* Right Column: Creator Controls & Fine Tuning */}
                                <div className="lg:col-span-7 space-y-4 bg-secondary/25 p-4 rounded-xl border border-border/30">
                                  <div className="flex items-center justify-between border-b border-border/20 pb-2">
                                    <h5 className="text-xs font-bold text-foreground uppercase tracking-wider">
                                      Customization Controls
                                    </h5>
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                      Position: {previewPos.toUpperCase()}
                                    </span>
                                  </div>

                                  {/* Row 1: Google Font & Vertical Position */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                      <label className="text-xs font-semibold text-muted-foreground block mb-1">
                                        Google Font Family
                                      </label>
                                      <select
                                        className="w-full bg-secondary/60 rounded-lg text-xs p-2.5 border border-border/40 font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                                        value={styleOverrides[clip.id]?.font_family ?? currentPreset.font_family}
                                        onChange={(e) =>
                                          setStyleOverrides((p) => ({
                                            ...p,
                                            [clip.id]: { ...p[clip.id], font_family: e.target.value },
                                          }))
                                        }
                                      >
                                        <option value="Montserrat">Montserrat (Viral Classic / Hormozi)</option>
                                        <option value="Anton">Anton (Bold Strong / MrBeast)</option>
                                        <option value="Bebas Neue">Bebas Neue (Tall Strong Headline)</option>
                                        <option value="Plus Jakarta Sans">Plus Jakarta Sans (Instagram Native)</option>
                                        <option value="Oswald">Oswald (Podcast High Energy)</option>
                                        <option value="Playfair Display">Playfair Display (Aesthetic Script)</option>
                                        <option value="Courier Prime">Courier Prime (Typewriter Story)</option>
                                        <option value="Rubik">Rubik (Smooth Rounded)</option>
                                        <option value="Inter">Inter (Clean Minimal)</option>
                                      </select>
                                    </div>

                                    <div>
                                      <label className="text-xs font-semibold text-muted-foreground block mb-1">
                                        Vertical Frame Position
                                      </label>
                                      <select
                                        className="w-full bg-secondary/60 rounded-lg text-xs p-2.5 border border-border/40 font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                                        value={styleOverrides[clip.id]?.position ?? currentPreset.position ?? "auto"}
                                        onChange={(e) =>
                                          setStyleOverrides((p) => ({
                                            ...p,
                                            [clip.id]: { ...p[clip.id], position: e.target.value },
                                          }))
                                        }
                                      >
                                        <option value="auto">Auto (Smart Face-Framing)</option>
                                        <option value="bottom">Bottom (Instagram Safe Zone)</option>
                                        <option value="center">Center (Split-Screen Div)</option>
                                        <option value="top">Top (Upper Third)</option>
                                      </select>
                                    </div>
                                  </div>

                                  {/* Row 2: Background Pill Box Style */}
                                  <div>
                                    <label className="text-xs font-semibold text-muted-foreground block mb-1">
                                      Subtitle Background Pill Box
                                    </label>
                                    <div className="grid grid-cols-3 gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setStyleOverrides((p) => ({
                                            ...p,
                                            [clip.id]: { ...p[clip.id], border_style: 1, bg_color: null },
                                          }))
                                        }
                                        className={`p-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                                          !hasBoxBg
                                            ? "border-primary bg-primary/20 text-primary ring-1 ring-primary"
                                            : "border-border/40 bg-secondary/40 text-muted-foreground hover:bg-secondary"
                                        }`}
                                      >
                                        None (Outline)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setStyleOverrides((p) => ({
                                            ...p,
                                            [clip.id]: {
                                              ...p[clip.id],
                                              border_style: 3,
                                              bg_color: "#FFFFFF",
                                              primary_color: "#111827",
                                            },
                                          }))
                                        }
                                        className={`p-2 rounded-lg text-xs font-semibold border transition-all text-center flex items-center justify-center gap-1.5 ${
                                          hasBoxBg && (boxBgColor === "#FFFFFF" || !boxBgColor)
                                            ? "border-primary bg-primary/20 text-primary ring-1 ring-primary"
                                            : "border-border/40 bg-secondary/40 text-muted-foreground hover:bg-secondary"
                                        }`}
                                      >
                                        <span className="w-2.5 h-2.5 rounded-full bg-white border" /> White Pill
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setStyleOverrides((p) => ({
                                            ...p,
                                            [clip.id]: {
                                              ...p[clip.id],
                                              border_style: 3,
                                              bg_color: "#000000",
                                              primary_color: "#FFFFFF",
                                            },
                                          }))
                                        }
                                        className={`p-2 rounded-lg text-xs font-semibold border transition-all text-center flex items-center justify-center gap-1.5 ${
                                          hasBoxBg && boxBgColor === "#000000"
                                            ? "border-primary bg-primary/20 text-primary ring-1 ring-primary"
                                            : "border-border/40 bg-secondary/40 text-muted-foreground hover:bg-secondary"
                                        }`}
                                      >
                                        <span className="w-2.5 h-2.5 rounded-full bg-black border border-white/40" /> Black Pill
                                      </button>
                                    </div>
                                  </div>

                                  {/* Row 3: Trending 1-Click Instagram Color Swatches */}
                                  <div>
                                    <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                                      Trending Highlight Color Palette
                                    </label>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {[
                                        { name: "Reels Gold", color: "#FFE600" },
                                        { name: "Emerald Green", color: "#22C55E" },
                                        { name: "Cyber Cyan", color: "#00F0FF" },
                                        { name: "Neon Pink", color: "#FF007A" },
                                        { name: "Sunset Orange", color: "#FF6B00" },
                                        { name: "Royal Blue", color: "#2563EB" },
                                        { name: "Pure White", color: "#FFFFFF" },
                                        { name: "Champagne", color: "#FCD34D" },
                                      ].map((swatch) => (
                                        <button
                                          key={swatch.color}
                                          type="button"
                                          title={swatch.name}
                                          onClick={() =>
                                            setStyleOverrides((p) => ({
                                              ...p,
                                              [clip.id]: { ...p[clip.id], highlight_color: swatch.color },
                                            }))
                                          }
                                          className={`w-7 h-7 rounded-full transition-transform hover:scale-110 shadow-sm border-2 ${
                                            previewHighlight.toLowerCase() === swatch.color.toLowerCase()
                                              ? "scale-115 border-white ring-2 ring-primary"
                                              : "border-transparent"
                                          }`}
                                          style={{ backgroundColor: swatch.color }}
                                        />
                                      ))}
                                    </div>
                                  </div>

                                  {/* Row 4: Custom Color Inputs */}
                                  <div className="grid grid-cols-2 gap-3 pt-1">
                                    <div>
                                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                                        Primary Text Color
                                      </label>
                                      <div className="flex items-center gap-2 bg-secondary/50 p-1.5 rounded-lg border border-border/30">
                                        <input
                                          type="color"
                                          className="h-6 w-6 rounded cursor-pointer bg-transparent border-0 p-0"
                                          value={previewColor}
                                          onChange={(e) =>
                                            setStyleOverrides((p) => ({
                                              ...p,
                                              [clip.id]: { ...p[clip.id], primary_color: e.target.value },
                                            }))
                                          }
                                        />
                                        <span className="text-xs font-mono uppercase text-foreground">{previewColor}</span>
                                      </div>
                                    </div>
                                    <div>
                                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                                        Active Highlight Color
                                      </label>
                                      <div className="flex items-center gap-2 bg-secondary/50 p-1.5 rounded-lg border border-border/30">
                                        <input
                                          type="color"
                                          className="h-6 w-6 rounded cursor-pointer bg-transparent border-0 p-0"
                                          value={previewHighlight}
                                          onChange={(e) =>
                                            setStyleOverrides((p) => ({
                                              ...p,
                                              [clip.id]: { ...p[clip.id], highlight_color: e.target.value },
                                            }))
                                          }
                                        />
                                        <span className="text-xs font-mono uppercase text-foreground">{previewHighlight}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Rendered Video Player */}
                        {clip.rendered_path && (
                          <div className="mb-6 animate-in fade-in zoom-in-95 duration-300">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                              Final Video
                            </h4>
                            <div className="rounded-xl overflow-hidden bg-black/40 border border-border/30 flex justify-center w-full p-2">
                              <video
                                src={api.getStreamUrl(jobId, clip.id)}
                                controls
                                autoPlay
                                loop
                                playsInline
                                className="max-h-[50vh] object-contain w-auto mx-auto rounded-lg shadow-2xl ring-1 ring-border/50"
                              />
                            </div>
                          </div>
                        )}

                        {/* Metadata */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Metadata
                            </h4>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={loadingMeta[clip.id]}
                              onClick={() => handleGenerateMetadata(clip.id)}
                              className="text-xs h-7"
                            >
                              {loadingMeta[clip.id] ? (
                                <span className="flex items-center gap-1.5">
                                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Generating...
                                </span>
                              ) : clip.title ? (
                                "Regenerate"
                              ) : (
                                "Generate with AI"
                              )}
                            </Button>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <label className="text-xs text-muted-foreground">Title</label>
                              <Input
                                value={clip.title ?? ""}
                                onChange={(e) =>
                                  handleUpdateField(clip.id, "title", e.target.value)
                                }
                                placeholder="Click 'Generate with AI' or type a title"
                                className="mt-1 bg-secondary/30 border-border/30 text-sm h-9"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">
                                Description
                              </label>
                              <Textarea
                                value={clip.description ?? ""}
                                onChange={(e) =>
                                  handleUpdateField(
                                    clip.id,
                                    "description",
                                    e.target.value
                                  )
                                }
                                placeholder="Click 'Generate with AI' or type a description"
                                rows={3}
                                className="mt-1 bg-secondary/30 border-border/30 text-sm resize-none"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Tags</label>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {(clip.tags ?? []).map((tag, i) => (
                                  <span key={i} className="tag-chip">
                                    {tag}
                                  </span>
                                ))}
                                {(!clip.tags || clip.tags.length === 0) && (
                                  <span className="text-xs text-muted-foreground italic">
                                    No tags yet
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3 pt-2">
                          <Button
                            onClick={() => handleRender(clip.id)}
                            disabled={loadingRender[clip.id] || !presets.length}
                            className="flex-1 bg-primary hover:bg-primary/90 font-semibold"
                          >
                            {loadingRender[clip.id] ? (
                              <span className="flex items-center gap-2">
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                {renderProgress[clip.id] != null ? `Rendering ${renderProgress[clip.id]}%` : "Rendering..."}
                              </span>
                            ) : clip.rendered_path ? (
                              "Re-render"
                            ) : (
                              "Render clip"
                            )}
                          </Button>

                          {clip.rendered_path && (
                            <a
                              href={api.getDownloadUrl(jobId, clip.id)}
                              download
                              className="inline-flex items-center justify-center gap-2 px-6 h-10 rounded-md font-semibold text-sm transition-colors"
                              style={{
                                background: "oklch(0.7 0.18 155)",
                                color: "oklch(0.13 0.02 280)",
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              Download
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      )}
    </main>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
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
