# ClipForge — Requirements (user's spec, verbatim + addendum merged)

Build "ClipForge", an AI-powered video clipping web app (an OpusClip alternative, but more customizable).

## 1. Product overview
A web app that takes a long-form video (upload or YouTube/URL), finds the most engaging moments using AI, and turns them into vertical short-form clips (9:16, also 1:1 and 16:9) with styled animated subtitles, branding/watermark, a viral score, and AI-written titles and descriptions. The user has full control over AI provider, subtitle design, and branding.

## 2. Core features

### 2.1 Video input
- Upload (MP4, MOV, MKV, WebM; drag & drop, progress bar, resumable for large files)
- Import from URL (YouTube, Vimeo, direct link; for gaming also Twitch, Kick VODs)
- Project library showing all past videos with thumbnail, duration, status, clip count

### 2.2 Processing pipeline
1. Extract audio → transcribe with word-level timestamps
2. Speaker diarization (optional)
2b. Detect content type, people count, facecam region and HUD zones (if Auto-detect is on)
3. Send transcript to the selected LLM to detect highlight segments (hooks, emotional peaks, punchlines, insights, complete thoughts)
4. Auto-reframe to 9:16 with face/speaker tracking (keep the active speaker centered)
5. Render clips with FFmpeg: subtitles, watermark, optional intro/outro
- Show live progress per stage (Transcribing → Analyzing → Reframing → Rendering) using a job queue

### 2.3 Content type modes & smart layouts
The user picks a content type when creating a project, or leaves it on **Auto-detect** (AI analyzes faces, on-screen layout, audio and transcript to guess the type). Each type changes how clips are found, cropped, laid out, scored and captioned. The user can override the detected type and layout per project or per clip.

**Content types:** Auto-detect, Podcast / Interview, Gaming / Stream, Talking head / Vlog, Tutorial / Screen recording, Reaction / Commentary, Sports, Custom

#### A. Podcast / Interview
- Detect number of people and camera setup (one wide camera with everyone in frame vs separate camera per person)
- Speaker diarization mapped to faces; editable speaker names and colors
- **1 person**
  - Face-tracked 9:16 crop, speaker kept centered with smooth motion (no jitter)
  - Subtitles in lower third, auto-adjusted so they never cover the face or mouth
- **2 people** (layout options)
  - **Active speaker:** auto-cut to whoever is talking, with a minimum shot length (e.g. 1.5s) and short transitions so it doesn't flicker on quick back-and-forth
  - **Split screen:** stacked top/bottom, each face tracked in its half; subtitles placed on the divider line between them
  - **Wide shot:** both people in frame with blurred background fill top and bottom; subtitles below the frame
  - Optional: subtitle color per speaker
- **3+ people** (layout options)
  - Active speaker switching (same rules as above)
  - Grid layout (2x2 or 3-stack) with the active speaker highlighted
  - Wide shot with blurred fill
  - Reaction cutaways: briefly show a listener reacting (laugh, surprise) when AI detects a strong reaction
- Highlight detection focuses on: strong opinions, stories, debates/disagreements, laughter, quotable one-liners, complete Q&A exchanges

#### B. Gaming / Stream (GTA 6, Call of Duty, Forza, Fortnite, Valorant, Minecraft, etc.)
- Import from upload or VOD link (Twitch, YouTube, Kick); optional Twitch chat log import
- **Facecam detection:** auto-detect the webcam overlay region, or let the user draw the facecam box manually; remember it per channel/template
- **Layouts**
  - Facecam top (30–40%) + gameplay bottom
  - Gameplay top + facecam bottom
  - Full gameplay with facecam as a picture-in-picture bubble (draggable, shape: circle/rounded rect)
  - Gameplay only (no facecam / no-commentary videos)
- **Gameplay crop modes:** center crop, AI action-follow (tracks the main movement), FPS mode (keeps crosshair centered), racing mode (keeps the car in frame), manual keyframed crop
- **HUD-aware subtitle placement:** subtitles avoid game HUD elements. Include game presets with safe zones (e.g. GTA minimap bottom-left, COD killfeed and minimap, Forza speedometer bottom-right, Fortnite build/health bar) plus a "draw custom safe zones" tool. Default subtitle spot is the seam between facecam and gameplay
- **Highlight detection for gaming** uses more than the transcript:
  - Audio spikes: shouting, screaming, laughing, sudden loud reactions
  - Visual game events: kills/multi-kills, wins, crashes, explosions, chases, fails, funny glitches
  - Chat activity spikes (if chat log imported): emote spam, "LMAO", "clip it"
  - Streamer face reactions (shock, laughter) from facecam
- No-commentary gameplay: captions optional; AI can add a short text hook overlay at the start ("This was the craziest escape 😳")
- Gaming-specific viral scoring: reaction intensity, action density, clutch/fail moments, game trend relevance (e.g. new release hype)

#### C. Talking head / Vlog
- Face-tracked crop, auto-zoom punch-ins on key words for energy, B-roll suggestion slots

#### D. Tutorial / Screen recording
- Auto-zoom to cursor and active screen area; facecam bubble if present; subtitles placed away from the zoomed area

#### E. Reaction / Commentary
- Stack layout: reactor face + original content; detect the reactor's webcam region the same way as facecam

#### F. Smart subtitle placement (all types)
- Auto-place captions avoiding faces, HUDs, burned-in on-screen text, and logos
- **Platform safe zones:** toggleable overlay showing where TikTok / Reels / Shorts UI (buttons on the right, caption area at the bottom) will cover the video; captions and watermark auto-stay inside the safe area
- Manual override: drag subtitles on the canvas, with snap guides
- Placement can change mid-clip if the layout changes (e.g. switching from split screen to single speaker)

#### G. Layout templates
- Save any layout (facecam box, crop mode, subtitle spot, watermark spot) as a reusable template, e.g. "My GTA stream layout" or "Podcast 2-cam"

### 2.4 AI clip analysis (per clip)
- **Viral score 0–100**, with a breakdown: hook strength (first 3 seconds), emotional impact, value / shareability, pacing & clarity, trend relevance
  - Scoring criteria adapt to content type (e.g. gaming weights reaction intensity and action; podcast weights hook and quotability)
- One-line explanation of why it scored that way, plus improvement tips
- **Title** (3 options, under 60 chars, hook-style)
- **Description** (platform-aware: YouTube Shorts, TikTok, Instagram Reels)
- **Hashtags** (5–10)
- Regenerate button for each field; sort/filter clips by score
- Settings: number of clips (auto / 3–20), clip length range (e.g. 15–60s, 30–90s), content language, tone (educational, funny, motivational, etc.)

### 2.5 AI provider settings
- Providers: Anthropic (Claude), OpenAI, Google (Gemini), Ollama (local), plus OpenAI-compatible custom endpoint (OpenRouter, Groq, LM Studio, etc.)
- Per provider: API key input (masked, stored encrypted), base URL (editable for Ollama/custom), "Test connection" button
- Model selection: dropdown auto-fetched from the provider's models endpoint (Ollama: `/api/tags`) with search, plus an "Add custom model ID" option
- Separate model choice per task (optional): highlight detection, scoring, titles/descriptions
- Unified provider abstraction layer in the backend so adding new providers is easy
- Graceful errors (invalid key, model not found, rate limits, Ollama not running)

### 2.6 Subtitle designer
- Preset gallery (at least 10 styles: bold "Hormozi-style", "MrBeast-style", minimal, karaoke highlight, neon, boxed, typewriter, etc.) with live animated previews
- Customization: font family (Google Fonts + upload custom font), size, weight, letter case; text color, highlight/active-word color, stroke color & width, shadow, background box (color, opacity, radius, padding); words per line / lines on screen; animation: word-by-word highlight, pop/bounce, fade, slide, typewriter, none; position: top / middle / bottom + vertical offset slider; auto emoji insertion and keyword emphasis (AI-chosen) toggles
- Save custom styles as presets; set a default
- Editable transcript: fix words, change timing, and see the change in the preview instantly

### 2.7 Watermark & branding
- Upload logo (PNG/SVG with transparency)
- Position: 9-point grid picker
- Opacity slider (0–100%), size slider (% of video width), margin/padding from edges
- Optional text watermark (e.g. @handle) with font, color, opacity
- Saved as brand kit in Settings and applied to all clips by default; override per clip

### 2.8 Clip editor
- Video preview with timeline; trim start/end; extend clip into neighboring transcript
- Toggle subtitles/watermark, change aspect ratio, change reframe focus manually
- Layout switcher per clip (thumbnails of each layout), speaker track on the timeline showing who talks when, and a facecam/safe-zone editing mode
- Export: 1080p/720p, MP4; batch download as ZIP
- Copy title/description/hashtags with one click

## 3. UI / UX
- **Layout:** top toolbar (undo/redo, device/aspect toggle as a segmented icon group, "Share/Preview" secondary button, dark "Save & Publish"-style primary button), a center canvas/preview area on a subtle dotted-grid background, a settings panel on the right, and a slim vertical icon navigation rail on the far right (icon + label, active item in a raised white card)
- Rail sections: **Clips, Layout, Subtitles, Branding, AI, Export, Settings**. The Layout panel uses visual thumbnail cards for each layout option instead of plain text buttons
- **Controls:** segmented controls for choices, the selected option shown as a white raised pill on a light gray track; sliders with a coral filled track and value label on the right; pill toggle switches; a live preview box at the bottom of each settings panel
- **Visual style:** light neutral background (#F4F4F5-ish panels on #E8E8EA), white cards, soft shadows, 10–14px radius, generous spacing, one accent color (coral ~#F26B5B) used only for active states, sliders, toggles and errors; near-black primary buttons
- **Typography:** clean geometric sans (Inter, Geist or similar); bold section headings, muted gray labels
- Dark mode with the same structure
- Smooth micro-interactions (150–200ms), skeleton loaders, empty states, toast notifications
- Responsive: full editor on desktop; library, clip review and downloads usable on mobile
- Clip results page: card grid with thumbnail, duration, colored viral-score badge (green 80+, amber 60–79, gray below), title, and quick actions
- (A reference screenshot was mentioned but not received.)

## 4. Pages
1. Dashboard / project library
2. New project (upload/URL + content type + clip settings)
3. Processing status
4. Clips results (grid, sort by score)
5. Clip editor (canvas + right settings panel + icon rail)
6. Settings: AI providers & models, brand kit/watermark, subtitle presets, layout templates, defaults, account (local profile)

## 5. Constraints from the user
- Runs locally; open-source repo anyone can clone and run. No accounts or cloud.
- Must run smoothly on a MacBook M3 with 8GB RAM first.
- Build in phases; clean, modular code; README with setup, env variables, and running Ollama locally.
- Ask before making major architecture decisions not covered here.
