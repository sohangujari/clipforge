# ClipForge

Local-first AI video clipping. ClipForge turns long videos into short vertical clips with animated subtitles, your branding, a viral score, and AI-written titles. It runs entirely on your own computer: there's no account and no cloud, and you bring your own AI keys or use a free local model through Ollama.

> **Status: Phase 1 of 8.** Every page and the editor are clickable, running on demo projects. AI provider settings, the brand kit, subtitle presets and defaults are real and saved locally. Upload and transcription arrive in Phase 2 (see the [roadmap](#roadmap)).

## Requirements

- **macOS 14+ on Apple Silicon** is recommended. ClipForge is tuned for an M3 with 8 GB of unified memory. Linux and Windows are best-effort.
- **Node.js 20+** (`node -v`)
- **FFmpeg** (`brew install ffmpeg`), needed from Phase 2
- Optional: **Ollama** for free, private, local AI

## Quick start

```bash
git clone <this repo> clipforge && cd clipforge
npm run setup      # installs dependencies, creates the local database
npm run dev        # http://127.0.0.1:3000 (only reachable from this Mac)
```

Then open **Settings → AI providers** and either paste an API key (Claude, OpenAI, Gemini, or any OpenAI-compatible endpoint such as OpenRouter, Groq or LM Studio) or turn on Ollama.

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `CLIPFORGE_DATA_DIR` | `<repo>/data` | Where the database, uploads, logos and renders live |

No API keys go in environment files. You enter them in Settings, and they're stored encrypted in the database.

## Running Ollama on an 8 GB Mac

```bash
brew install ollama
ollama serve              # leave running (or start the Ollama app)
ollama pull qwen3:4b      # or another 2–4B model
```

On 8 GB of unified memory, the GPU and CPU share the same RAM. A 7–8B model takes about 5 GB on its own and will push the Mac into swap while ClipForge transcribes or renders. **Stick to 2–4B models.** The model picker flags anything over 4 GB with "May be slow on 8GB". Cloud providers use no local memory.

If Settings says *"Ollama isn't running"*, start it with `ollama serve`, then click **Test connection** again.

## Where your data and keys live

- Everything is in `data/` (gitignored): `clipforge.db` (SQLite), `logos/`, `fonts/`, and later `media/` and `renders/`.
- API keys are encrypted with AES-256-GCM, using a random key in `data/.secret` (file mode 600). This keeps keys unreadable in the database file and in backups. It does **not** protect against someone who can already log in as you on this machine.
- Keys are never sent back to the browser; Settings only shows the last 4 characters.

## Development

```bash
npm test                       # unit tests (Vitest)
npm --prefix web run e2e       # browser tests (Playwright; uses a temp data dir)
npm --prefix web run build     # production build
```

Code lives in `web/` (Next.js 16, App Router, Tailwind 4, shadcn/ui). Design docs are in `docs/superpowers/specs/`.

## Roadmap

1. ✅ UI shell + settings (AI providers, brand kit, presets, defaults)
2. Import (upload, YouTube/Twitch/Kick/Vimeo) + transcription on the M3 GPU (mlx-whisper)
3. AI analysis: highlights, viral score, titles, descriptions, hashtags
4. Rendering: face-tracked crops, burned-in subtitles, watermark, intro/outro, export
5. Full editor: trim/extend, transcript timing, subtitle designer, layout switcher
6. Podcast modes: speaker detection, active-speaker/split/grid layouts, layout templates
7. Gaming: facecam detection, gaming layouts, HUD safe zones, audio/chat spikes
8. Advanced: action-follow, game-event detection, reactions, tutorial zoom, more
