# ClipForge Phase 1 — UI Shell + Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every ClipForge page and the clip editor shell, all running on mock project and clip data. Settings are real and saved to disk: AI providers (with live connection testing and model fetching), the brand kit, subtitle presets, defaults and the local profile.

**Architecture:** This phase is a single Next.js 16 app in `web/`. SQLite (`data/clipforge.db`) is accessed through Prisma 7 and holds only `Provider` and `Setting` in this phase. API keys are encrypted with AES-256-GCM using `data/.secret`. Model listing calls each provider's HTTP endpoint directly with `fetch`; the Vercel AI SDK is used only for the one-token "test generate" call. Projects and clips are fixtures in `web/lib/mock.ts`. The Python worker starts in Phase 2.

**Tech Stack:** Next.js 16.4 (App Router, TS) · Tailwind CSS 4 · shadcn/ui (CLI 4) · motion 14 · next-themes 0.4 · sonner 2 · lucide-react · Prisma 7 + `@prisma/adapter-better-sqlite3` · zod 4 · `ai` 7 + `@ai-sdk/{anthropic,openai,google,openai-compatible}` · Vitest 5 · Playwright 1.65.

**Spec:** [docs/superpowers/specs/2026-11-15-clipforge-design.md](../specs/2026-11-15-clipforge-design.md) and [requirements](../specs/2026-11-15-clipforge-requirements.md). Read both before starting.

## Global Constraints

- Primary target: MacBook M3 with **8GB unified memory**. No Docker, Postgres or Redis. Setup is `npm run setup`, then run with `npm run dev`.
- All app data lives under `<repo>/data/` (gitignored). The location can be overridden with the `CLIPFORGE_DATA_DIR` env var; tests use this.
- Colours: page bg `#E8E8EA`, panels `#F4F4F5`, cards white, accent coral `#F26B5B`, used **only** for active states, sliders, toggles and errors. Primary buttons are near-black (`#111113`). Radius 10–14px (use 12px as the default). Soft shadows. Dark mode keeps the same structure.
- Font: **Geist** (via `next/font`), with bold section headings and muted gray labels.
- Micro-interactions take 150–200ms. Pages use skeleton loaders, empty states and sonner toasts.
- Score badge: green when 80 or above, amber for 60–79, gray below 60.
- Editor rail order: **Clips, Layout, Subtitles, Branding, AI, Export, Settings**.
- Providers: `anthropic`, `openai`, `google`, `ollama`, `custom` (OpenAI-compatible). Ollama defaults to base URL `http://localhost:11434`.
- An API key is never sent back to the browser. Responses show it only as `••••` plus its last 4 characters.
- Local Ollama models over **4 GB** get a RAM warning when `os.totalmem()` ≤ 8 GiB.
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Ollama not running or wrong base URL.** Test and model fetch return `unreachable` with "Ollama isn't running — start it with `ollama serve`" within ~5s, with no endless spinner (Task 3 test `unreachable within timeout`).
2. **A pasted API key with spaces or a trailing newline** is trimmed before it's saved (Task 4 test `trims key`).
3. **Saving a provider with the key field left blank** keeps the existing key and doesn't wipe it (Task 4 test `blank key keeps existing`).
4. **`data/.secret` deleted or replaced after keys were saved.** The provider shows `needsKey: true` and the UI asks for the key again, with no 500 (Task 4 test `undecryptable key`).
5. **375px phone width.** The library, clips grid and settings have no horizontal scroll (Task 6 Playwright test `mobile no overflow`).

## File Structure

```
package.json                 root scripts: setup, dev, test (delegate to web/)
.gitignore                   node_modules, data/, .next, *.db
README.md                    setup, env vars, Ollama on 8GB
web/
  prisma/schema.prisma       Provider, Setting
  prisma.config.ts
  lib/db.ts                  Prisma client singleton
  lib/paths.ts               dataDir(), ensures dirs
  lib/secret.ts              encrypt/decrypt, key file
  lib/ai/types.ts            ProviderKind, ProviderConfig, ModelInfo, ProviderError
  lib/ai/providers.ts        listModels, testConnection, getModel
  lib/ai/errors.ts           mapProviderError
  lib/providers-store.ts     load/save providers (encryption boundary)
  lib/settings.ts            zod schemas + get/set for Setting keys
  lib/mock.ts                mock projects + clips
  lib/clips.ts               sortClips, scoreTone
  lib/history.ts             undo/redo reducer
  lib/subtitle-presets.ts    10 built-in SubtitleStyle presets
  lib/layouts.ts             layout option catalogue (id, label, contentTypes, SVG thumb spec)
  components/ui/*            shadcn primitives (restyled)
  components/cf/*            Segmented, CfSlider, ScoreBadge, PositionGrid, ModelPicker, PanelPreview, EmptyState
  app/(app)/layout.tsx       top bar + nav for non-editor pages
  app/(app)/page.tsx                              library
  app/(app)/new/page.tsx                          new project
  app/(app)/projects/[id]/processing/page.tsx
  app/(app)/projects/[id]/clips/page.tsx
  app/(app)/settings/[section]/page.tsx           ai | brand | subtitles | layouts | defaults | profile
  app/editor/[projectId]/[clipId]/page.tsx        editor (own full-screen layout)
  app/editor/.../panels/*.tsx                     one file per rail section
  app/api/providers/route.ts                      GET
  app/api/providers/[kind]/route.ts               PUT
  app/api/providers/[kind]/test/route.ts          POST
  app/api/providers/[kind]/models/route.ts        GET
  app/api/settings/[key]/route.ts                 GET, PUT
  app/api/uploads/logo/route.ts                   POST
  app/api/files/[...path]/route.ts                GET (serves data/logos, data/fonts)
  tests/*.test.ts                                 vitest
  e2e/*.spec.ts                                   playwright
```

---

### Task 1: Repo scaffold, theme tokens and base controls

**Files:**
- Create: `package.json`, `.gitignore`, `README.md` (stub), `web/` via `npx create-next-app@16.4.6 web --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm`
- Create: `web/app/globals.css` (tokens), `web/components/cf/{Segmented,CfSlider,ScoreBadge,EmptyState}.tsx`, `web/lib/clips.ts`
- Test: `web/tests/clips.test.ts`, `web/vitest.config.ts`

**Interfaces:**
- Produces: `scoreTone(score: number): 'green' | 'amber' | 'gray'`; `<Segmented<T> value options={{value:T,label?:string,icon?:ReactNode}[]} onChange />`; `<CfSlider value min max step unit? onChange />` (coral filled track, value label on the right); `<ScoreBadge score />`; `<EmptyState icon title body action? />`.
- Theme: CSS variables `--cf-bg --cf-panel --cf-card --cf-accent --cf-text --cf-muted --cf-border --cf-primary` on `:root` and `.dark`, mapped to shadcn tokens. `next-themes` with `attribute="class"`, default `system`.

- [ ] **Step 1:** Run `git init` in the repo root. Commit the existing `docs/` as-is first (`docs: add ClipForge design and Phase 1 plan`).
- [ ] **Step 2:** Scaffold `web/` with the command above. Run `npx shadcn@4.23.0 init` (neutral base), then `npx shadcn add button card input label select switch tabs dialog dropdown-menu command popover skeleton tooltip badge separator textarea`. Install `next-themes sonner motion lucide-react` and dev deps `vitest @vitejs/plugin-react jsdom @testing-library/react @playwright/test`. Root `package.json` scripts: `"setup": "npm --prefix web ci && npm --prefix web run db:push"`, `"dev": "npm --prefix web run dev"`, `"test": "npm --prefix web test"`. Add `data/` to `.gitignore`.
- [ ] **Step 3: Write failing test** `web/tests/clips.test.ts`:
```ts
test('scoreTone thresholds', () => {
  expect(scoreTone(100)).toBe('green'); expect(scoreTone(80)).toBe('green')
  expect(scoreTone(79)).toBe('amber'); expect(scoreTone(60)).toBe('amber')
  expect(scoreTone(59)).toBe('gray');  expect(scoreTone(0)).toBe('gray')
})
```
- [ ] **Step 4:** Run `npm --prefix web test`. Expected: FAIL (`scoreTone` not defined).
- [ ] **Step 5:** Implement `scoreTone` in `web/lib/clips.ts`, the tokens in `globals.css`, Geist via `next/font`, the `ThemeProvider` and `<Toaster />` in `app/layout.tsx`, and the four `cf` components. `Segmented` is a gray track with the selected option as a white raised pill that moves with a 150ms `motion` `layoutId` animation.
- [ ] **Step 6:** Run `npm --prefix web test && npm --prefix web run build`. Expected: PASS, build succeeds.
- [ ] **Step 7:** Commit `feat: scaffold web app with theme tokens and base controls`.

### Task 2: Database, data dir and secret encryption

**Files:**
- Create: `web/prisma/schema.prisma`, `web/prisma.config.ts`, `web/lib/paths.ts`, `web/lib/db.ts`, `web/lib/secret.ts`
- Test: `web/tests/secret.test.ts`

**Interfaces:**
- Produces: `dataDir(): string` (reads `CLIPFORGE_DATA_DIR`, defaulting to `<repo>/data`; creates `logos/ fonts/` subdirs); `db` (PrismaClient using the better-sqlite3 adapter on `file:${dataDir()}/clipforge.db`, WAL enabled via `PRAGMA journal_mode=WAL` on first connect); `encrypt(plain: string): string` returns `v1:<iv b64>:<tag b64>:<ct b64>`; `decrypt(blob: string): string` throws `SecretError` on a bad tag or key.
- Schema:
```prisma
model Provider { kind String @id  baseUrl String?  apiKeyEnc String?  enabled Boolean @default(false)  updatedAt DateTime @updatedAt }
model Setting  { key  String @id  value String  updatedAt DateTime @updatedAt }   // value = JSON
```
- `web/package.json` script `"db:push": "prisma db push"`.

- [ ] **Step 1: Write failing tests** in `secret.test.ts`, each using a fresh temp `CLIPFORGE_DATA_DIR`:
  - `roundtrip`: `decrypt(encrypt('sk-abc'))` returns `'sk-abc'`.
  - `random iv`: `encrypt('x') !== encrypt('x')`.
  - `tamper`: flipping one char of the ciphertext makes `decrypt` throw `SecretError`.
  - `key file mode`: after the first `encrypt`, `(statSync(dataDir()+'/.secret').mode & 0o777) === 0o600`.
  - `wrong key`: encrypt, delete `.secret`, reset the module cache, then `decrypt` throws `SecretError`.
- [ ] **Step 2:** Run `npm --prefix web test secret`. Expected: FAIL.
- [ ] **Step 3:** Implement with `node:crypto` (`aes-256-gcm`, 12-byte IV, 32-byte key from `randomBytes`, file written with `{ mode: 0o600 }`). Write the Prisma schema, config and `db.ts`, using the global singleton pattern for Next dev hot reload.
- [ ] **Step 4:** Run `npm --prefix web test secret && npm --prefix web run db:push`. Expected: PASS, and `data/clipforge.db` is created.
- [ ] **Step 5:** Commit `feat: sqlite via prisma and AES-GCM secret store`.

### Task 3: AI provider layer (listing, testing, errors)

**Files:**
- Create: `web/lib/ai/types.ts`, `web/lib/ai/errors.ts`, `web/lib/ai/providers.ts`
- Test: `web/tests/providers.test.ts`

**Interfaces:**
- Produces:
```ts
type ProviderKind = 'anthropic'|'openai'|'google'|'ollama'|'custom'
interface ProviderConfig { kind: ProviderKind; baseUrl?: string; apiKey?: string }
interface ModelInfo { id: string; label: string; sizeBytes?: number; ramWarning?: boolean }
type ProviderErrorCode = 'invalid_key'|'model_not_found'|'rate_limited'|'unreachable'|'unknown'
class ProviderError extends Error { code: ProviderErrorCode; userMessage: string }
listModels(cfg: ProviderConfig, opts?: { totalMem?: number; timeoutMs?: number }): Promise<ModelInfo[]>   // throws ProviderError
testConnection(cfg: ProviderConfig, modelId?: string): Promise<{ ok: true; modelCount: number } | { ok: false; error: { code: ProviderErrorCode; message: string } }>
getModel(cfg: ProviderConfig, modelId: string): LanguageModel   // AI SDK
mapProviderError(e: unknown, kind: ProviderKind): ProviderError
```
- Endpoints (default `timeoutMs` 5000 via `AbortSignal.timeout`):
  - anthropic: `GET https://api.anthropic.com/v1/models?limit=1000` with headers `x-api-key`, `anthropic-version: 2023-06-01` → `data[].id`, `display_name`
  - openai: `GET {baseUrl ?? 'https://api.openai.com/v1'}/models` with Bearer → `data[].id`
  - google: `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000` with header `x-goog-api-key` → keep `supportedGenerationMethods` that include `generateContent`; id = `name` without the `models/` prefix
  - ollama: `GET {baseUrl}/api/tags` → `models[].name`, `size`; `ramWarning = size > 4e9 && totalMem <= 8 * 2**30`. `getModel` uses `@ai-sdk/openai-compatible` at `{baseUrl}/v1`.
  - custom: `GET {baseUrl}/models` with optional Bearer → `data[].id`
- Error mapping: HTTP 401/403 → `invalid_key` ("API key was rejected"); 404 on a model → `model_not_found`; 429 → `rate_limited` ("Rate limited — wait a moment and retry"); fetch TypeError/ECONNREFUSED/AbortError → `unreachable`. For ollama the message is "Ollama isn't running — start it with `ollama serve`"; otherwise "Can't reach {baseUrl}".
- `testConnection` = `listModels`, plus, when `modelId` is given, `generateText({ model, prompt: 'ping', maxOutputTokens: 1 })`.

- [ ] **Step 1: Write failing tests** with `vi.stubGlobal('fetch', ...)`:
  - Each kind parses its fixture response into `ModelInfo[]` (google drops a model with only `embedContent`; ids have `models/` removed).
  - The ollama `ramWarning` is true for `size: 5e9` with `totalMem: 8*2**30`, false for `2.7e9`, and false for `5e9` with 16 GiB.
  - `401` → `ProviderError` code `invalid_key`; `429` → `rate_limited`.
  - `unreachable within timeout`: real fetch to `http://127.0.0.1:9` (ollama) rejects with code `unreachable` and the "ollama serve" message in under 6000ms.
- [ ] **Step 2:** Run `npm --prefix web test providers`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npm --prefix web test providers`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: unified AI provider layer with model listing and error mapping`.

### Task 4: Provider + settings persistence and API routes

**Files:**
- Create: `web/lib/providers-store.ts`, `web/lib/settings.ts`, `web/app/api/providers/**`, `web/app/api/settings/[key]/route.ts`, `web/app/api/uploads/logo/route.ts`, `web/app/api/files/[...path]/route.ts`
- Test: `web/tests/providers-store.test.ts`, `web/tests/settings.test.ts`

**Interfaces:**
- Consumes: `db`, `encrypt/decrypt`, `listModels/testConnection` (Tasks 2–3).
- Produces:
```ts
interface ProviderView { kind: ProviderKind; baseUrl?: string; enabled: boolean; keyHint?: string /* '••••abcd' */; needsKey: boolean }
listProviderViews(): Promise<ProviderView[]>            // always all 5 kinds, defaults filled in
saveProvider(kind, input: { baseUrl?: string; apiKey?: string; enabled?: boolean }): Promise<ProviderView>
loadProviderConfig(kind): Promise<ProviderConfig>       // decrypted; server-only
// settings.ts — zod schema per key, defaults when unset:
SettingKey = 'aiTasks'|'brandKit'|'subtitlePresets'|'defaults'|'profile'
getSetting<K>(key: K): Promise<SettingValue<K>>; setSetting<K>(key: K, v: unknown): Promise<SettingValue<K>>  // throws ZodError
```
- Setting shapes (defaults in brackets):
  - `aiTasks`: `{ highlight, scoring, titles, vision }`, each `{ provider: ProviderKind, model: string } | null` [all null]
  - `brandKit`: `{ logoPath?: string; position: 'tl'|'tc'|'tr'|'ml'|'c'|'mr'|'bl'|'bc'|'br' ['br']; opacity 0–100 [80]; sizePct 2–40 [12]; marginPct 0–15 [4]; text?: { value, font ['Geist'], color ['#FFFFFF'], opacity [70] }; introPath?: string; outroPath?: string }`
  - `subtitlePresets`: `{ custom: SubtitleStyle[]; defaultId: string ['bold-pop'] }` (`SubtitleStyle` comes from Task 7; define the zod schema there and import it here; until then use `z.any()` and tighten it in Task 7)
  - `defaults`: `{ clipCount: 'auto'|number(3–20) ['auto']; lengthRange: [15,60]|[30,90]|[60,180] [[30,90]]; language ['auto']; tone: 'educational'|'funny'|'motivational'|'dramatic'|'neutral' ['neutral']; contentType: 'auto'|'podcast'|'gaming'|'vlog'|'tutorial'|'reaction'|'sports'|'custom' ['auto']; whisperModel: 'large-v3-turbo'|'medium'|'small' ['large-v3-turbo'] }`
  - `profile`: `{ name ['']; handle [''] }`, plus read-only `dataDir` and `diskUsageBytes` added by the GET route
- Routes: `GET /api/providers` → `ProviderView[]`. `PUT /api/providers/[kind]` → `ProviderView`. `POST /api/providers/[kind]/test` body `{modelId?}` → the testConnection result. `GET /api/providers/[kind]/models` → `{ models: ModelInfo[] }` or `{ error }` with status 200 (errors are data, not 500s). `GET|PUT /api/settings/[key]` (unknown key → 404, invalid body → 400 with zod issues). `POST /api/uploads/logo` (multipart; accepts only `image/png` or `image/svg+xml`, ≤ 5 MB, magic bytes checked; saved to `data/logos/<uuid>.<ext>`) → `{ path }`. `GET /api/files/[...path]` serves only from `data/logos` and `data/fonts`: resolve and reject paths outside them, and send headers `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `X-Content-Type-Options: nosniff` (SVGs can carry scripts).

- [ ] **Step 1: Write failing tests** (temp `CLIPFORGE_DATA_DIR`, `db:push` in `beforeAll`):
  - `trims key`: `saveProvider('openai',{apiKey:'  sk-123456\n'})`, then `loadProviderConfig` gives `apiKey === 'sk-123456'`, and the view's `keyHint === '••••3456'`.
  - `blank key keeps existing`: save a key, then `saveProvider('openai',{apiKey:'', baseUrl:'https://x/v1'})`; the key is unchanged.
  - `undecryptable key`: save a key, delete `.secret`, reset modules; `listProviderViews()` resolves with `needsKey: true` for openai.
  - `never leaks key`: the JSON from `GET /api/providers` (call the exported `GET` handler directly) contains no `sk-123456`.
  - `ollama default`: with an empty DB, the ollama view has `baseUrl === 'http://localhost:11434'`.
  - Settings: `getSetting('defaults')` returns the defaults above; `setSetting('defaults',{...,clipCount:25})` throws; `PUT /api/settings/nope` → 404.
  - `files traversal`: `GET /api/files/logos/../../clipforge.db` → 404.
- [ ] **Step 2:** Run `npm --prefix web test providers-store settings`. Expected: FAIL.
- [ ] **Step 3:** Implement. All the route files call the store and settings functions; no business logic in route files.
- [ ] **Step 4:** Run `npm --prefix web test`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat: provider and settings persistence with API routes`.

### Task 5: Mock data, history reducer, layout and preset catalogues

**Files:**
- Create: `web/lib/mock.ts`, `web/lib/history.ts`, `web/lib/layouts.ts`, `web/lib/subtitle-presets.ts`
- Modify: `web/lib/clips.ts` (add `sortClips`)
- Test: `web/tests/history.test.ts`, `web/tests/clips.test.ts`, `web/tests/presets.test.ts`

**Interfaces:**
- Produces:
```ts
interface MockProject { id; title; durationSec; status: 'queued'|'processing'|'ready'|'failed'; stage?: 'importing'|'transcribing'|'detecting'|'analyzing'|'reframing'; progress?: number; clipCount; contentType; thumbnail: string /* gradient css */; createdAt: string }
interface ScoreBreakdown { hook; emotion; value; pacing; trend: number; extra?: Record<string, number> }
interface MockClip { id; projectId; startSec; endSec; score: number; breakdown: ScoreBreakdown; reason: string; tips: string[]; titles: [string,string,string]; descriptions: { shorts; tiktok; reels: string }; hashtags: string[]; transcript: { w: string; s: number; e: number; speaker?: number }[] }
mockProjects: MockProject[]   // ≥5: ready podcast, ready gaming, processing (stage 'analyzing', 0.6), failed, queued
getMockClips(projectId): MockClip[]   // ≥8 for ready projects, scores spread across all three tones
sortClips(clips, by: 'score'|'duration'|'time', dir: 'asc'|'desc' = 'desc'): MockClip[]   // non-mutating; ties broken by startSec asc
// history.ts
interface History<T> { past: T[]; present: T; future: T[] }
historyReducer<T>(h: History<T>, a: { type: 'set'; value: T } | { type: 'undo' } | { type: 'redo' }): History<T>   // 'set' clears future; past capped at 100
// layouts.ts
interface LayoutOption { id: 'single'|'active-speaker'|'split'|'wide-blur'|'grid'|'facecam-top'|'facecam-bottom'|'pip'|'gameplay-only'|'reaction-stack'|'screen-zoom'; label; contentTypes: ContentType[]; thumb: { x,y,w,h, kind: 'face'|'game'|'screen'|'blur'|'caption' }[] /* 0–1 rects drawn as SVG */ }
// subtitle-presets.ts
SubtitleStyleSchema (zod) + type SubtitleStyle: { id; name; font; sizePx; weight; case: 'none'|'upper'|'lower'; color; activeColor; stroke: { color; width }; shadow: { color; blur; x; y } | null; box: { color; opacity; radius; padding } | null; wordsPerLine; lines: 1|2; animation: 'highlight'|'pop'|'fade'|'slide'|'typewriter'|'none'; position: 'top'|'middle'|'bottom'; offsetPct: number; emoji: boolean; emphasis: boolean }
builtinPresets: SubtitleStyle[]   // exactly 10, ids: bold-pop, big-yellow, minimal, karaoke, neon, boxed, typewriter, outline-clean, retro, subtle-fade
```
Note: preset names must be descriptive ("Bold Pop", "Big Yellow"), not creators' names.

- [ ] **Step 1: Write failing tests:**
  - history: set a→b→c, undo twice gives present `a`; redo gives `b`; set `d` after an undo gives empty `future`; 150 sets give `past.length === 100`; undo with empty past returns the same object.
  - sortClips: by score desc puts the highest first; the input array isn't mutated; equal scores are ordered by startSec.
  - presets: `builtinPresets.length === 10`; each passes `SubtitleStyleSchema.parse`; ids are unique; no name contains "MrBeast" or "Hormozi".
  - mock: each ready project has ≥8 clips, and clip scores include ≥1 of each tone.
- [ ] **Step 2:** Run `npm --prefix web test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. Tighten the `subtitlePresets.custom` zod in `settings.ts` to `SubtitleStyleSchema.array()`.
- [ ] **Step 4:** Run `npm --prefix web test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: mock data, undo history, layout and subtitle preset catalogues`.

### Task 6: App pages — library, new project, processing, clips

**Files:**
- Create: `web/app/(app)/layout.tsx`, `web/app/(app)/page.tsx`, `web/app/(app)/new/page.tsx`, `web/app/(app)/projects/[id]/processing/page.tsx`, `web/app/(app)/projects/[id]/clips/page.tsx`, `web/components/cf/ClipCard.tsx`
- Test: `web/e2e/pages.spec.ts`, `web/playwright.config.ts` (webServer `npm run dev`, `CLIPFORGE_DATA_DIR` set to a temp dir)

**Interfaces:**
- Consumes: `mockProjects`, `getMockClips`, `sortClips`, `ScoreBadge`, `Segmented`, `EmptyState`, `getSetting('defaults')`.
- Behaviour:
  - Library: a responsive card grid (thumbnail, title, duration `m:ss`, status chip, clip count) and a "New project" primary button. `?empty=1` shows the empty state. Skeletons show while loading (`loading.tsx`).
  - New project: a drag-and-drop zone accepting `.mp4,.mov,.mkv,.webm` (shows the file name and size; no upload this phase), a URL input, a content-type picker as visual cards (8 types), and clip settings prefilled from `defaults` (count `Segmented` auto/custom + `CfSlider` 3–20, length range `Segmented`, language select, tone select). Submit shows the toast "Processing arrives in Phase 2 — showing a demo" and goes to `/projects/p-processing/processing`.
  - Processing: a stage stepper for the 5 stages from the design with the current stage animated, a progress bar, and a Cancel button (toast). The mock progress increments client-side; when it reaches 1, a "View clips" button appears.
  - Clips: a `Segmented` sort (Score / Duration / Time), a min-score filter `CfSlider`, and a grid of `ClipCard`s (thumbnail, duration, `ScoreBadge`, first title, actions: Edit → editor route, Copy title/desc/hashtags, Download → toast). Clicking a card opens a sheet with the score breakdown bars, reason, tips, 3 titles, platform descriptions, hashtags, a copy button for each field, and Regenerate buttons (disabled, tooltip "Phase 3").

- [ ] **Step 1: Write failing Playwright tests:**
  - `routes render`: `/`, `/new`, `/projects/p-processing/processing`, `/projects/p-podcast/clips` each return 200 with no console errors and show their h1.
  - `sort by score`: on clips, choose Score; the first card's badge number ≥ the second's.
  - `mobile no overflow`: at a 375×812 viewport, for `/`, `/projects/p-podcast/clips` and `/settings/ai`, `document.documentElement.scrollWidth <= 375`. (Settings comes from Task 8; mark it `test.fixme` until then.)
  - `theme toggle`: clicking the theme toggle adds the `dark` class on `<html>`.
- [ ] **Step 2:** Run `npx --prefix web playwright test pages`. Expected: FAIL.
- [ ] **Step 3:** Implement the pages to the Global Constraints visual spec.
- [ ] **Step 4:** Run `npx --prefix web playwright test pages`. Expected: PASS (settings overflow still fixme).
- [ ] **Step 5:** Commit `feat: library, new project, processing and clips pages on mock data`.

### Task 7: Clip editor shell

**Files:**
- Create: `web/app/editor/[projectId]/[clipId]/page.tsx`, `.../EditorShell.tsx`, `.../Toolbar.tsx`, `.../Canvas.tsx`, `.../Rail.tsx`, `.../Timeline.tsx`, `.../panels/{Clips,Layout,Subtitles,Branding,Ai,Export,Settings}Panel.tsx`, `web/components/cf/{PositionGrid,PanelPreview,LayoutThumb}.tsx`
- Test: `web/e2e/editor.spec.ts`

**Interfaces:**
- Consumes: `historyReducer`, `layouts`, `builtinPresets`, `getMockClips`, `getSetting('brandKit')`, `Segmented`, `CfSlider`.
- Editor state (held in `historyReducer`): `{ aspect: '9:16'|'1:1'|'16:9'; layoutId; styleId; style: SubtitleStyle; subtitlesOn: boolean; watermarkOn: boolean; brand: BrandKit; trim: { start; end }; safeZone: 'off'|'tiktok'|'reels'|'shorts' }`.
- Layout: Toolbar (undo/redo with ⌘Z / ⇧⌘Z, an aspect `Segmented` with icons, a "Preview" secondary button, a near-black "Export" primary button); the canvas on a dotted-grid background showing a mock frame (gradient + placeholder faces per layout thumb rects) at the chosen aspect, with a CSS-rendered subtitle line from the current style and the watermark at its grid position; the right settings panel; the slim rail on the far right (icon + label, active = raised white card).
  - Timeline: clip range on the full-video bar with draggable trim handles, plus a speaker-track row coloured by `transcript[].speaker`.
  - Panels: **Clips** (the project's clip list, switching clip); **Layout** (`LayoutThumb` cards filtered by content type, plus a "Safe zones" `Segmented` that toggles a platform overlay on the canvas); **Subtitles** (a gallery of the 10 presets with CSS-animated previews, full customisation controls for every `SubtitleStyle` field, "Save as preset" → `setSetting('subtitlePresets')`, and an editable transcript list where editing a word updates the canvas immediately); **Branding** (`PositionGrid` 3×3, opacity/size/margin sliders, a text watermark, a logo from the brand kit, "Override for this clip" toggle); **AI** (score breakdown + titles/desc, read-only this phase); **Export** (1080p/720p `Segmented`, "Export clip" and "Download all as ZIP" → toast "Rendering arrives in Phase 4"); **Settings** (links to /settings sections).
  - Each panel ends with a `PanelPreview` box.
  - The canvas subtitle is a CSS approximation in Phase 1. JASSUB replaces it in Phase 4. Mark it `// ponytail: CSS preview, swapped for JASSUB (libass) in Phase 4 for render parity`.
  - Mobile: under 1024px the editor shows the notice "Open the editor on a larger screen", with links back to the clips page.

- [ ] **Step 1: Write failing Playwright tests:**
  - `rail order`: the rail labels read exactly `Clips, Layout, Subtitles, Branding, AI, Export, Settings`.
  - `undo redo`: change aspect to 1:1, press ⌘Z → the aspect control shows 9:16; ⇧⌘Z → 1:1.
  - `transcript edit live`: in the Subtitles panel, change the first transcript word to `HELLO` → the canvas subtitle contains `HELLO`.
  - `watermark position`: in Branding, click the top-left cell → the canvas watermark's bounding box is in the top-left quadrant of the canvas.
  - `layout thumbs`: the Layout panel shows ≥4 cards for a podcast clip and includes `facecam-top` for a gaming clip.
- [ ] **Step 2:** Run `npx --prefix web playwright test editor`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx --prefix web playwright test editor`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: clip editor shell with rail, panels, timeline and undo`.

### Task 8: Settings pages and README

**Files:**
- Create: `web/app/(app)/settings/layout.tsx` (section tabs; a select on mobile), `web/app/(app)/settings/[section]/page.tsx`, `web/app/(app)/settings/_sections/{Ai,Brand,Subtitles,Layouts,Defaults,Profile}.tsx`, `web/components/cf/ModelPicker.tsx`
- Modify: `README.md` (full), `web/e2e/pages.spec.ts` (un-fixme settings overflow)
- Test: `web/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: all the `/api/providers/*`, `/api/settings/*` and `/api/uploads/logo` routes from Task 4; `builtinPresets`; the `Branding` panel controls from Task 7 (reuse that component, not a copy).
- Sections:
  - **AI:** one card per provider: enabled switch, masked key input (placeholder shows `keyHint`; blank = keep), base URL (editable for ollama/custom; for custom, a name field is not needed this phase), a "Test connection" button (spinner, then a green ✓ with model count or a coral error with `userMessage`), and a `ModelPicker`. `ModelPicker` is a shadcn `Command` popover: it fetches `/models` on open, has search, a "Add custom model ID" row, and shows a `ramWarning` badge ("May be slow on 8GB"). Below the cards is "Model per task": 4 rows (highlight, scoring, titles, vision), each provider select + `ModelPicker`, saved to `aiTasks`. On an 8GB machine, a callout recommends a 3–4B Ollama model.
  - **Brand kit:** logo upload (PNG/SVG) with a preview via `/api/files/...`, the Branding controls, intro/outro "Coming in Phase 4" placeholders; saved to `brandKit`.
  - **Subtitles:** built-in and custom presets with "Set default" and delete (custom only).
  - **Layouts:** empty state "Save a layout from the editor to reuse it" (templates arrive in Phase 6).
  - **Defaults:** every `defaults` field.
  - **Profile:** name, handle, read-only data folder path and disk usage; "Clear cache" disabled ("Phase 2").
  - Every save shows a toast; failed saves show a coral toast with the error.

- [ ] **Step 1: Write failing Playwright tests:**
  - `ollama live` (skip unless `fetch('http://localhost:11434/api/tags')` succeeds in `beforeAll`): Test connection on Ollama shows ✓, and the ModelPicker lists at least one model returned by `/api/tags`.
  - `ollama down message`: set the Ollama base URL to `http://127.0.0.1:9`, save, Test → the text "ollama serve" is visible within 7s.
  - `key masked`: enter `sk-test-abcd1234` for OpenAI, save, reload → the input is empty and the placeholder contains `1234`; the page HTML does not contain `sk-test-abcd1234`.
  - `defaults persist`: set tone to Funny, reload → it is still Funny.
  - `custom model id`: in the ModelPicker type `my-model:latest` → "Add custom model ID" → the picker shows `my-model:latest` as selected.
- [ ] **Step 2:** Run `npx --prefix web playwright test settings`. Expected: FAIL.
- [ ] **Step 3:** Implement the sections. Write `README.md` with: what ClipForge is; requirements (macOS 14+ on Apple Silicon recommended, Node 20+, ffmpeg); `npm run setup` / `npm run dev`; env vars (`CLIPFORGE_DATA_DIR`); Ollama on 8GB (`brew install ollama`, `ollama serve`, `ollama pull qwen3:4b` or a ~2–4B model, and why larger models will swap); where keys are stored and the limits of that encryption; the phase roadmap.
- [ ] **Step 4:** Run `npm test && npx --prefix web playwright test`. Expected: all PASS (`ollama live` passes on this machine: `qwen3.5:2b` is installed).
- [ ] **Step 5:** Commit `feat: settings pages for providers, brand kit, presets, defaults, profile; README`.

---

## Phases 2–8 (roadmap; each gets its own plan)

Phase 2 import + transcription (Python worker, `uv`, mlx-whisper, jobs table, SSE) · Phase 3 AI analysis · Phase 4 render v1 + JASSUB preview + intro/outro · Phase 5 editor (real) · Phase 6 podcast modes · Phase 7 gaming core · Phase 8 advanced. See design §8.
