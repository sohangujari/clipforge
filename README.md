# ClipForge

Local-first AI video clipping. ClipForge turns long videos into short vertical clips with animated subtitles, your branding, a viral score, and AI-written titles. It runs entirely on your own device: there's no account and no cloud, and you bring your own AI keys or use a free local model through Ollama.

> **Status: Phase 3 of 8.** Paste a link or upload a file, and ClipForge transcribes it on your device and **finds clips**. Clips start and end on full sentences, laughter and applause in the audio count as evidence, and every clip has a viral score with a reason per dimension, 3 titles, platform descriptions and hashtags. You can search for moments in plain language, and keep or delete clips to teach it your taste. Rendering finished videos arrives in Phase 4 (see the [roadmap](#roadmap)).

## Requirements

- **macOS 14+ on Apple Silicon** is recommended. ClipForge is tuned for an M3 with 8 GB of unified memory and transcribes on the GPU. Linux and Windows are best-effort and transcribe on the CPU.
- **Node.js 20+** (`node -v`)
- **FFmpeg** (`brew install ffmpeg`)
- **uv**, the Python package manager (`brew install uv`). Setup uses it to create the worker's own Python 3.12 environment, so your system Python doesn't matter.
- Optional: **Ollama** for free, private, local AI

## Quick start

```bash
git clone <this repo> clipforge && cd clipforge
npm run setup      # installs dependencies, creates the local database and the worker's Python env
npm start          # builds once, then runs the app + worker → http://127.0.0.1:3000 (only reachable from this device)
```

`npm start` is the everyday mode: the production server uses about half the memory of the development server (measured on an 8 GB M3). `npm run dev` is for working on ClipForge's code.

Then open **Settings → AI providers** and either paste an API key (Claude, OpenAI, Gemini, Cloudflare Workers AI, or any OpenAI-compatible endpoint such as OpenRouter, Groq or LM Studio) or turn on Ollama.

**Cloudflare Workers AI:** enter your Account ID (Cloudflare dashboard → Workers AI) and an API token with *Workers AI: Read*. The free plan gives 10,000 neurons a day across all models, resetting at 00:00 UTC.

**Speech model (one-time download):** the first transcription downloads the speech model, about 1.6 GB for the default *Large v3 Turbo*. It's stored in `~/.cache/huggingface/` and reused for every later video. The processing page shows the download with MB progress, and an interrupted download resumes where it stopped. To get it out of the way up front, run:

```bash
npm run setup:models          # or: npm run setup:models -- small   (≈ 480 MB, faster, a bit less accurate)
```

You can switch models in **Settings → Defaults → Transcription model**; each model downloads once.

## How processing works

`npm run dev` runs two processes: the web app and a **worker**. The worker takes one video at a time, so an 8 GB device never runs two heavy models together. It goes through these steps:

1. **Importing:** downloads the link with yt-dlp, or checks the uploaded file.
2. **Preparing:** makes a 480p preview copy (using the hardware encoder on Apple Silicon), a 16 kHz audio file and a thumbnail.
3. **Transcribing:** word-level timestamps with mlx-whisper on the GPU. The model is unloaded afterwards to free memory.
4. **Hinglish captions** (optional): romanises Hindi with your AI model.

Each step is a checkpoint. If you cancel, close the terminal or the worker crashes, **Retry** (or simply restarting `npm run dev`) continues from the last finished step.

**Custom words:** add names and brand words on the New project page or in Settings → Defaults. They're passed to the speech model so they get spelled exactly as you typed them.

**Hinglish:** for Hindi videos, choose *Captions script → Hinglish*. It needs a model set under **Settings → AI → Model per task** (Titles or Highlight). Without one, you get the Hindi-script transcript and a warning.

## Finding clips

After transcription, ClipForge runs two more steps:

1. **Listening for reactions.** A small audio model (Google's YAMNet, ~15 MB, CPU) marks laughter, applause and cheering, plus loudness and speech pace. A 12-minute video takes about 5 seconds and ~380 MB of memory. Reactions are judged against each video's own normal level, so quiet laughter under speech still counts.
2. **Finding clips.** Your AI model picks which sentences make a strong clip. ClipForge sets the exact start and end in code, so clips never start or end mid-sentence and always fit your length setting. It then scores each clip (hook, emotion, value, pacing, trend, plus extras per content type, each with a reason). The overall score is calculated in code, with a boost where the audience actually reacted.

On the clips page you can:

- **Hover** a clip to preview it, and open it to see the score breakdown and copy text for each platform.
- **Regenerate** titles, descriptions or hashtags.
- **Keep** (bookmark) or **delete** clips. Future runs use your choices as examples of what you like.
- **Find a moment**: describe it ("where they talk about blind dates") and ClipForge adds matching clips, or tells you nothing matched.
- **Find clips again** after changing settings. Clips you kept stay.

Videos transcribed before an AI model was set get a **Find clips** button on their transcript page.

### Which AI model?

Clip quality depends on the model. Measured on an 8 GB M3 with a 12-minute podcast:

| Model | Where | Cost | Notes |
|---|---|---|---|
| **Gemini Flash** (highlights) + **Flash-Lite** (scoring, titles) | cloud | free tier: about 20 and 500 requests a day | best picks; ClipForge uses about 3 requests per video, so roughly 20 videos a day free |
| **gpt-oss-120b** (highlights) + **gemma-4-26b-a4b-it** (scoring, titles) on Cloudflare Workers AI | cloud | free: 10,000 neurons a day | good picks (9–11 clips, scores 64–86), no load on your device; about 1.5 minutes per 12-minute video (gpt-oss thinks while picking highlights; ClipForge turns Gemma's thinking off for scoring and titles, 10× faster). Free use is roughly 10–20 videos a day (estimate) |
| **qwen3.5:4b** via Ollama | your device | free, unlimited, private | good picks, but **on an 8 GB Mac the whole Mac lags** while it works (it fills ~4.4 GB and the GPU, and macOS swaps). About 7–13 minutes per 12-minute video. Fine on 16 GB or more |
| qwen3.5:2b via Ollama | your device | free | lighter (~3.1 GB) but **still strains an 8 GB Mac**: free memory fell to 2%, macOS swapped 1.6 GB and the system stuttered 19 times; 10 minutes per 12-minute video; fewer, weaker clips. The offline option if you can't use a cloud model |

**On an 8 GB Mac, use a cloud model for a smooth experience.** Local models are best on 16 GB or more.

Set the model per task in **Settings → AI → Model per task**. Local models get the transcript in ~900-word pieces with a 4K context and thinking turned off, are unloaded after every request (Ollama's MLX engine otherwise grows its memory with each request), and score at most 6 candidates with short reasons. Cloud models get the whole transcript at once, so moments are ranked against each other. If a free tier says "slow down", ClipForge waits and retries. If the daily quota runs out, it keeps the clips already found and tells you. Settings shows today's request count per model.

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `CLIPFORGE_DATA_DIR` | `<repo>/data` | Where the database, videos, transcripts and logos live |
| `YT_BROWSER_COOKIES` | unset | Browser to borrow YouTube cookies from (`chrome`, `safari`, `firefox`, …), for age-restricted or sign-in-only videos |
| `CLIPFORGE_WHISPER_REPO` | unset | Override the speech model (any `mlx-community/whisper-*` repo) |

No API keys go in environment files. You enter them in Settings, and they're stored encrypted in the database.

## Running Ollama on an 8 GB Mac

```bash
brew install ollama
ollama serve              # leave running (or start the Ollama app)
ollama pull qwen3:4b      # or another 2–4B model
```

On 8 GB of unified memory, the GPU and CPU share the same RAM. A 7–8B model takes about 5 GB on its own and will push the Mac into swap while ClipForge transcribes or renders. **Stick to 2–4B models.** The model picker flags anything over 4 GB with "May be slow on 8GB". Cloud providers use no local memory.

If Settings says *"Ollama isn't running"*, start it with `ollama serve`, then click **Test connection** again.

## Troubleshooting

- **"The worker isn't running"** on the processing page: start ClipForge with `npm start` (or `npm run dev`), which starts both the app and the worker, not `npm --prefix web run dev`.
- **"Video is private or unavailable"** or **"age-restricted"**: set `YT_BROWSER_COOKIES=chrome` (or your browser) for a browser where you're signed in, then click Retry.
- **Downloads suddenly fail on YouTube**: update yt-dlp with `uv lock --upgrade-package yt-dlp --directory worker && uv sync --directory worker`.

## Where your data and keys live

- Everything is in `data/` (gitignored): `clipforge.db` (SQLite), `media/<project>/` (source video, preview, audio, thumbnail, `transcript.json`), `uploads/` (unfinished uploads), `logos/` and `fonts/`.
- API keys are encrypted with AES-256-GCM, using a random key in `data/.secret` (file mode 600). This keeps keys unreadable in the database file and in backups. It does **not** protect against someone who can already log in as you on this machine.
- Keys are never sent back to the browser; Settings only shows the last 4 characters. The worker reaches your AI model only through the local web app (`data/.worker-token`).

## Credits

- Reaction detection uses [YAMNet](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet) (Apache-2.0), in the ONNX export `andrelgomes/yamnet-onnx`. The class map `worker/clipforge_worker/assets/yamnet_class_map.csv` comes from tensorflow/models (Apache-2.0).

## Development

```bash
npm test                                    # web unit tests (Vitest) + worker tests (pytest)
CLIPFORGE_SLOW=1 uv run --directory worker pytest -q   # + a real transcription with whisper-tiny
npm --prefix web run e2e                    # browser tests incl. a real upload → transcript (temp data dir)
npm --prefix web run build                  # production build
```

Code lives in `web/` (Next.js 16, App Router, Tailwind 4, shadcn/ui) and `worker/` (Python 3.12: yt-dlp, FFmpeg, mlx-whisper).

## Roadmap

1. ✅ UI shell + settings (AI providers, brand kit, presets, defaults)
2. ✅ Import (upload, YouTube/Twitch/Kick/Vimeo) + transcription on the GPU, custom words, Hinglish
3. ✅ Best-in-class clip finding: clean clip boundaries, laughter/applause + AI signals, plain-language clip search, a viral score you can trust that learns your taste, titles, descriptions, hashtags
4. Rendering: face-tracked crops, burned-in subtitles, watermark, intro/outro, filler-word and silence removal, auto-zoom, export
5. Full editor: edit by transcript, frame-precise trims, subtitle designer, layout switcher
6. Podcast modes: speaker detection, active-speaker/split/grid layouts, layout templates
7. Gaming: facecam detection, gaming layouts, HUD safe zones, chat spikes
8. Advanced: action-follow, game-event detection, reactions, tutorial zoom, more
