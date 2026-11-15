# ClipForge — Design

Date: 2026-11-15
Status: ready for approval

## 1. Intent

ClipForge is an open-source, local-first alternative to OpusClip. You give it a long video (an upload, or a link from YouTube, Twitch, Kick or Vimeo). It finds the most engaging moments and renders short vertical clips with styled animated subtitles, a watermark, a viral score, and AI-written titles, descriptions and hashtags. The user controls the AI provider, subtitle design, branding and layout.

**Why:** OpusClip-style tools are hosted, closed and hard to customise. ClipForge will be a public repo that anyone clones and runs on their own machine, with full control and the option of a fully local AI (Ollama).

**Primary target:** a MacBook Air/Pro M3 with **8GB RAM**. It must run smoothly there before anything else. Linux and Windows are best-effort.

The full feature list is in [2026-11-15-clipforge-requirements.md](2026-11-15-clipforge-requirements.md), the user's spec with the content-type addendum merged in. This doc does not repeat it. It records the decisions that spec leaves open, and the constraints that shape how it's built.

## 2. Goals, non-goals, anti-goals

**Goals**
- Every feature in the user's spec, delivered in the phases in §8.
- Smooth on an M3 with 8GB: no swap thrashing, no frozen UI, the machine stays usable during processing.
- Clone → one setup command → one run command → it works.
- The whole pipeline works with **no paid API** (Ollama + local Whisper). Cloud providers are optional upgrades. *(My call: it follows from local-first and open-source.)*

**Non-goals**
- Accounts, login, multi-user, sharing, hosted deployment, cloud storage. The spec's "Settings → account" page becomes a **local profile**: display name, default handle for the text watermark, data folder location, disk usage, and a "clear cache" control.
- Posting directly to TikTok, YouTube or Instagram (not requested).
- Native mobile apps. The responsive web UI covers mobile viewing as the spec describes.

**Anti-goals** (failing these means it failed, even if it technically works)
- Running two heavy models at once and pushing an 8GB Mac into swap.
- Setup that needs Docker, Postgres, Redis or manual Python fiddling.
- A subtitle preview that doesn't match the rendered video.

## 3. Constraints found during recon

- The machine has Node 24, FFmpeg (Homebrew), Ollama, Redis, Postgres and Docker installed. **System Python is 3.14**, which MediaPipe and some Whisper packages don't support yet. The worker uses its own **Python 3.12**, managed by `uv`.
- **faster-whisper (CTranslate2) can't use the GPU on Apple Silicon.** On macOS arm64 we use **mlx-whisper**, which runs on Metal. faster-whisper stays as the fallback on other platforms.
- 8GB is shared by the OS, browser, Next.js dev server, worker, Whisper and Ollama. A 7–8B Ollama model (~5GB) cannot run at the same time as Whisper.
- The UI reference screenshot was **not received**. The UI follows the written design language in spec §3.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Next.js app (UI, settings, DB, AI-provider layer) + Python media worker (Whisper, MediaPipe, diarization, FFmpeg). SQLite for data and the job queue. | Two languages, but each does what it's best at. The only option where diarization, face/facecam tracking and audio analysis work well. |
| B | Everything in TypeScript: Next.js calls the whisper.cpp program, FFmpeg and onnxruntime-node. | One language and one install. But diarization, face tracking and motion analysis are poorly supported, so the podcast and gaming modes would be fragile. |
| C | Python (FastAPI) serves everything, with a plain React (Vite) front end. | Lighter than Next.js. But it moves away from the requested stack (Next.js + shadcn) for little gain. |

The user asked for my recommendation, and I chose **A**.

## 5. Architecture (decided)

### 5.1 Repo layout
```
clipforge/
  web/        Next.js 16 (App Router) + TS + Tailwind + shadcn/ui + Framer Motion
  worker/     Python 3.12 (uv) FastAPI media service + job runner
  shared/     JSON Schemas for the cross-language contracts (subtitle style, layout spec, job payloads)
  data/       gitignored: clipforge.db, media/, proxies/, renders/, fonts/, logos/, models/
  scripts/    setup.sh (checks/installs ffmpeg, uv, node deps, worker deps), dev runner
  README.md
```
`npm run setup` runs once. `npm run dev` starts both processes (Next on :3000, worker on :8765) via `concurrently`.

### 5.2 Data
- **SQLite** at `data/clipforge.db`, WAL mode. **Prisma 7** (better-sqlite3 driver adapter) in `web/` owns the schema and migrations. The worker reads and writes the same file with Python's stdlib `sqlite3` (job rows, progress, results only).
- Media files live on local disk under `data/`. The DB stores only paths.
- API keys are encrypted with **AES-256-GCM**, using a key generated on first run in `data/.secret` (gitignored, chmod 600). This keeps keys unreadable in the DB and in backups. It doesn't defend against someone who already has access to the machine; the README says so.

### 5.3 Jobs and progress
- A `jobs` table (id, project_id, type, stage, progress 0–1, status, error, payload JSON, timestamps) is the queue.
- The **worker owns the pipeline**. It polls for queued jobs and runs **one heavy job at a time** (memory rule below). Stages: `importing → transcribing → detecting → analyzing → reframing`. **Rendering is not part of the analysis pipeline.** Each export creates its own `render` job (one per clip, or a batch for ZIP), so finished MP4s are made only for the clips the user exports. *(The user's choice.)* Each stage is a resumable checkpoint, so after a crash or restart the job continues from the last completed stage.
- The Next.js UI gets live progress through a **Server-Sent Events** route that reads the job row every ~500ms.
- Cancel: the UI sets `status=cancel_requested`; the worker checks it between stages and between ffmpeg segments.

### 5.4 AI provider layer (one implementation, in TypeScript)
- Lives in `web/lib/ai/`. Built on the **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`).
- **Ollama** goes through its OpenAI-compatible `/v1` endpoint; models are listed from `/api/tags`. **Custom endpoints** (OpenRouter, Groq, LM Studio) use the same OpenAI-compatible adapter.
- Model lists are fetched from each provider's models endpoint, with search and an "add custom model ID" option. A model can be assigned per task (highlight detection, scoring, titles/descriptions, vision).
- All LLM output is **structured JSON validated with zod** (`generateObject`). Small local models get one repair retry.
- When the **worker** needs the LLM mid-pipeline, it calls `POST http://localhost:3000/api/internal/llm` with a task name and inputs. That route is bound to localhost and protected by a shared token stored in `data/.secret`. This way there's exactly one provider layer.
- Errors are mapped to clear UI messages: invalid key, model not found, rate limited (with backoff), Ollama not running, context too long.

### 5.5 Long transcripts
Highlight detection splits the transcript into **overlapping windows** (~8–10 min with ~1 min overlap, sized to the model's context; smaller for local models). It finds candidates per window, deduplicates, and then ranks globally. This lets it work on small Ollama models and keeps cloud costs predictable.

### 5.6 Media pipeline (worker)
1. **Import:** `yt-dlp` for URLs (YouTube, Twitch, Kick, Vimeo). Uploads are chunked and resumable (custom chunk endpoint in Next; byte-offset resume). The file is stored once.
2. **Proxy:** make a 480p H.264 proxy plus a 16kHz mono WAV. All analysis and the editor preview use the proxy. Only the final render reads the original.
3. **Transcribe:** mlx-whisper on macOS arm64 (default model `large-v3-turbo`, user-selectable down to `small`); faster-whisper elsewhere. Word-level timestamps. **The model is unloaded after this stage.**
4. **Diarization (optional):** **pyannote** when the user provides a Hugging Face token (it requires accepting the model licence). Without one, ClipForge uses **visual active-speaker detection** (mouth-movement signal from MediaPipe face landmarks, matched to who's speaking over time). Speakers are then mapped to faces, with names and colours editable.
5. **Detect (2b):** content type (if Auto), number of people, camera setup, facecam region, HUD zones. Uses MediaPipe face detection on frames sampled at 2–5 fps from the proxy, plus layout heuristics: a facecam is a stable small region holding a face over a moving background. The LLM gets a transcript sample and these signals to make the final content-type call. The user can override.
6. **Analyze:** highlights → viral score (weights depend on content type) → titles, descriptions, hashtags, through the provider layer.
7. **Reframe:** per-clip face, facecam or action tracks are smoothed (One-Euro filter with a dead-zone, so no jitter). Active-speaker cuts follow a minimum shot length of 1.5s. The output is a **layout spec**.
8. **Render (on export only):** an FFmpeg `filter_complex` is built from the layout spec, with ASS subtitles burned in and the watermark overlaid. On macOS it uses the **`h264_videotoolbox`** hardware encoder (falling back to libx264). Output is 1080p or 720p MP4.

### 5.7 Memory budget (8GB rule)
- The M3 has **8GB of unified memory**: GPU (Metal) memory comes out of the same 8GB as everything else, so GPU work counts against this budget too. The worker caps MLX's cache (`mx.set_cache_limit`) and calls `mx.clear_cache()` after transcription.
- One heavy stage at a time across the whole app. Whisper is unloaded before any local LLM call. MediaPipe is light (~100–200MB).
- Ollama calls pass `keep_alive: 0` after the analyze stage, so the model is released.
- **The rule covers UI-triggered local LLM calls too** (regenerate title or description, re-score). Any call to a *local* provider (Ollama, or a custom endpoint marked local) takes a shared `heavy_lock` row in SQLite. While the worker holds it, the UI shows "queued, waiting for transcription" and runs the call once the lock frees. Cloud-provider calls skip the lock. *(My call.)*
- In Settings, local models over ~4GB on a machine with ≤8GB RAM show a warning. The recommended defaults for 8GB are a 3–4B model (e.g. `qwen3:4b`, `gemma3:4b`). *(My call: the exact recommended list gets checked against what Ollama offers at build time.)*
- Frame analysis reads the proxy at reduced fps and never decodes the full-resolution original.

### 5.8 Two cross-language contracts (JSON Schema in `shared/`)
- **Subtitle style:** font, size, weight, case, colours, stroke, shadow, box, words per line, lines, animation, position or offset, emoji and emphasis toggles, per-speaker colours. **One renderer:** the worker turns style + words into an ASS file (`\k` karaoke, `\t` transforms, `\move`/`\fad`). The editor preview draws the **same ASS** over the proxy video with **JASSUB** (libass compiled to WASM), so the preview and FFmpeg's burn-in both use libass and match by construction. The style → ASS generator is ported to TypeScript for instant preview while editing; a unit test checks both generators produce identical ASS for the preset set. *(My call, from the builder check: it replaces a hand-written DOM renderer, which could never match libass exactly.)*
- **Layout spec:** output size; regions (each with source rect keyframes, destination rect, shape, border); background fill (blur/colour); subtitle anchor keyframes; watermark position; safe zones. Every layout in the spec (active speaker, split, wide+blur, grid, facecam-top, facecam-bottom, PiP bubble, gameplay-only, reaction stack) is just a different layout spec. **Layout templates** are saved layout specs with source-relative coordinates.

### 5.9 UI
- Intro/outro bumpers live in the brand kit (§8 phase 4). Pages, rail sections (Clips, Layout, Subtitles, Branding, AI, Export, Settings), controls, colours, dark mode and micro-interactions as in spec §3. Built with shadcn/ui primitives restyled to the spec: coral `#F26B5B` accent, near-black primary buttons, dotted-grid canvas.
- Results-page thumbnails are JPEG frames taken from the proxy at each clip's best-face timestamp. Hover previews and the editor both play the proxy with the layout and subtitles drawn on top, so no MP4 is needed until export.
- The editor canvas plays the **proxy** in a `<video>` element. Layout, subtitles, watermark and safe-zone overlays are drawn over it in DOM/canvas from the same layout spec and style JSON the renderer uses (WYSIWYG).
- Platform safe-zone overlays (TikTok, Reels, Shorts) are static masks per platform. Captions and watermark are constrained to the safe area.

## 6. Content-type modes: feasibility on 8GB

| Feature | Approach | When |
|---|---|---|
| Face-tracked crop, podcast 1/2/3+ layouts, active-speaker cuts | MediaPipe + diarization/visual speaker | Phase 4–6 |
| Facecam auto-detect + manual box, remembered per channel | Heuristic above + stored template | Phase 7 |
| HUD safe-zone presets (GTA, COD, Forza, Fortnite, Valorant, Minecraft) + draw custom | Hand-authored normalized rects in a JSON preset file; user-editable | Phase 7 |
| Audio spikes (shouting, laughter) | RMS/onset energy + a small laughter classifier (YAMNet-class, CPU) | Phase 7 |
| Twitch chat log spikes | Import a chat JSON/CSV file; message-rate + keyword/emote spikes | Phase 7 |
| FPS mode (crosshair centred) | Fixed centre crop with a small dead-zone | Phase 7 |
| AI action-follow, racing mode | Optical-flow motion centroid on the proxy (OpenCV), smoothed | Phase 8 |
| Visual game events (kills, wins, crashes, explosions, fails) | **Opt-in cloud vision**: sample frames around audio/chat spikes and send them to a vision model chosen in AI settings. Off by default; cost estimate shown before running | Phase 8 |
| Facecam reactions (shock, laughter), reaction cutaways | MediaPipe face blendshapes (local, light) | Phase 8 |
| Tutorial auto-zoom to cursor/active area | Frame-difference regions + cursor template match | Phase 8 |
| Vlog punch-in zooms, B-roll suggestion slots | Zoom keyframes on LLM-chosen keywords; B-roll = empty slots with suggested search terms (no stock-footage integration) | Phase 8 |
| Burned-in text / logo avoidance | Apple Vision OCR on macOS (via `ocrmac`), tesseract fallback; regions become safe zones | Phase 8 |
| No-commentary hook text overlay | LLM-written hook rendered as an ASS title event | Phase 7 |
| Sports | *(My call: no spec detail.)* Action-follow crop + audio spikes + generic scoring weights | Phase 8 |

## 7. Viral scoring
- Five base dimensions from spec 2.3 (hook, emotion, value, pacing, trend). Each content type has its own **weight table** plus up to two extra dimensions (gaming: reaction intensity, action density, clutch/fail; podcast: quotability). The weights live in a JSON file so they're tunable.
- The LLM scores each dimension 0–100 with a one-line reason. The **overall score is a weighted average computed in code**, not by the LLM, so it's consistent and sortable.
- "Trend relevance" uses only the LLM's own knowledge (no live trend API). The UI labels it as an estimate. *(My call.)*

## 8. Phases
1. **UI shell + settings with mock data:** all pages, rail, controls, dark mode, AI provider settings with real connection testing and model fetching.
2. **Import + transcription:** upload (resumable) and URL import, proxy, mlx-whisper, project library, live progress.
3. **AI analysis:** provider layer to the worker, content-type detect (transcript-only first), highlight detection, scoring, titles/descriptions/hashtags, clips results page.
4. **Render v1:** face-tracked 9:16/1:1/16:9 crop, ASS subtitles with the presets, watermark/brand kit, **optional intro/outro** (uploaded video bumpers in the brand kit, scaled and padded to the output size and frame rate, then concatenated), VideoToolbox export, ZIP batch download.
5. **Editor:** timeline, trim/extend, editable transcript with live preview, subtitle designer, layout switcher, reframe override.
6. **Podcast modes:** diarization, speaker track, active-speaker/split/wide/grid layouts, layout templates.
7. **Gaming core:** facecam detect/draw, gaming layouts, HUD presets and safe-zone editor, audio and chat spikes, FPS mode, hook overlay, platform safe zones.
8. **Advanced:** action-follow and racing, vision events, reactions and cutaways, tutorial zoom, vlog punch-ins and B-roll slots, OCR avoidance, sports.

Each phase ends with the app runnable end-to-end on the M3 and a short check (see §9).

## 9. Testing
- A unit test for each piece of non-trivial logic: score weighting, transcript windowing and dedupe, shot-length enforcement, the smoothing filter, layout-spec → filtergraph, style → ASS.
- A **subtitle parity test**: the TS and Python style → ASS generators produce identical ASS for every preset (§5.8).
- A **smoke test per phase**: a bundled ~60s CC-licensed sample video run through the whole pipeline, with a peak-RSS check that the worker stays under ~3GB with the default local models. *(My call: threshold to be confirmed on the M3.)*

## 10. Implementation plan scope
The first implementation plan covers **Phase 1 in task-level detail**, with Phases 2–8 as a roadmap. Each later phase gets its own detailed plan when it starts. *(My call.)*

## 11. Left to the builder
- Exact shadcn components, file and module structure inside `web/` and `worker/`.
- The LLM prompt wording, and the zod schemas beyond the fields the spec lists.
- Which 10+ subtitle presets to ship and their exact values (as long as they cover the styles named in the spec and aren't copies of trademarked branding).
- The heuristics' thresholds (facecam stability, spike detection, dead-zone sizes). Expose the important ones as advanced settings.
- How the resumable chunked upload is implemented.
