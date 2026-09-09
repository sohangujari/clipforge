# ClipForge

Turn a long YouTube video into short-form clips: auto-detected best moments,
subject-tracked 9:16 crop, burned-in captions (with Hindi-to-Hinglish
support), and AI-generated title/description/tags per clip.

Local-only for now - no auth, no cloud storage, no database. Two processes
running on your machine talking over localhost.

## Status

This is the initial scaffold. Wired up and smoke-tested end-to-end:
FastAPI app, all routes, JSON storage, GLM calls for clip scoring/Hinglish/
metadata, and the Next.js interface (job submission, job list with live
status polling, clip candidate review).

**Not yet built** - these need real videos to test against, not just scaffolding:
- `engine/app/pipeline/track_subject.py` - face detection + crop-path smoothing
- `engine/app/pipeline/render_clip.py` - the ffmpeg crop + subtitle burn pass
- `engine/app/pipeline/transcribe.py` - written but not yet run against real
  audio (faster-whisper will download model weights on first real use)

Suggested next step: a standalone CLI script that runs transcribe -> select
clips -> track_subject -> render_clip against one real video, outside the
FastAPI job flow, so you can iterate on those three pieces fast without
going through the UI each time.

## Setup

### Backend (`engine/`)

```bash
cd engine
python3 -m venv .venv
source .venv/bin/activate        # .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
# edit .env - add your GLM_API_KEY
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` to confirm it's up - FastAPI's
auto-generated API explorer, useful for poking endpoints by hand before
the UI is fully wired to all of them.

Note: `mediapipe` and `faster-whisper` are sizeable installs (model weights
download on first real use, not at `pip install` time). If `pip install -r
requirements.txt` is slow, that's why.

### Frontend (`web/`)

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev
```

Visit `http://localhost:3000`. The `shadcn/ui` config (`components.json`)
and base components (button, card, input, label, textarea, badge) were
hand-written rather than pulled via `npx shadcn init` - the CLI's registry
domain wasn't reachable from the sandbox this was built in. Worth running
`npx shadcn@latest init` once you have this locally, so the CLI can
reconcile `components.json` against whatever the current version expects,
before adding more components (`npx shadcn add dropdown-menu`, etc.).

### Running both

Two terminals: `uvicorn` in one, `npm run dev` in the other. Paste a
YouTube URL into the UI - it'll queue a job, and the background pipeline
will download, transcribe, and score candidate clips (once those pieces
are actually tested - see Status above).

## Repo layout

```
engine/    FastAPI backend + processing pipeline
web/       Next.js interface
```

See inline docstrings in `engine/app/pipeline/*.py` for the intended
approach on each unbuilt piece.
