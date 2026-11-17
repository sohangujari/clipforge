import { beforeEach, expect, test, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { freshDb } from './helpers'

let dir: string
beforeEach(() => { dir = freshDb(); vi.resetModules() })
const ctx = <T extends Record<string, unknown>>(p: T) => ({ params: Promise.resolve(p) })
const db = async () => (await import('@/lib/db')).getDb()
const settings = { clipCount: 'auto', lengthRange: [30, 90], language: 'auto', tone: 'neutral', vocabulary: [], captionScript: 'native' }

async function projectWithClips() {
  const { createProject } = await import('@/lib/projects')
  const p = await createProject({ sourceType: 'url', url: 'https://x.test/v', settings: settings as never, contentType: 'podcast' })
  const m = join(dir, 'media', p.id)
  mkdirSync(m, { recursive: true })
  writeFileSync(join(m, 'transcript.json'), JSON.stringify({ language: 'en', words: [
    { w: 'Hello', s: 10, e: 10.4 }, { w: 'world.', s: 10.5, e: 11 }, { w: 'Later', s: 50, e: 50.5 }] }))
  const base = { breakdown: '{"hook":80,"emotion":70,"value":60,"pacing":70,"trend":50,"reasons":{}}', reason: 'r', tips: '[]',
    titles: '["T1","T2","T3"]', descriptions: '{"shorts":"s","tiktok":"t","reels":"r"}', hashtags: '["#a"]', signals: '{}' }
  const d = await db()
  const ids = [randomUUID(), randomUUID(), randomUUID()]
  await d.clip.createMany({ data: [
    { id: ids[0], projectId: p.id, startSec: 10, endSec: 40, score: 70, ...base },
    { id: ids[1], projectId: p.id, startSec: 45, endSec: 80, score: 90, ...base },
    { id: ids[2], projectId: p.id, startSec: 0, endSec: 30, score: 99, status: 'deleted', ...base },
  ] })
  return { p, ids }
}

test('lists clips sorted by score, hides deleted, slices transcript', async () => {
  const { p, ids } = await projectWithClips()
  const { GET } = await import('@/app/api/projects/[id]/clips/route')
  const body = await (await GET(new Request('http://x'), ctx({ id: p.id }))).json()
  expect(body.clips.map((c: { id: string }) => c.id)).toEqual([ids[1], ids[0]])
  expect(body.clips[1].transcript.map((w: { w: string }) => w.w)).toEqual(['Hello', 'world.'])
  expect(body.clips[1].titles).toEqual(['T1', 'T2', 'T3'])
  expect(body.tasteCount).toBe(0)
})

test('PATCH kept writes feedback with summary', async () => {
  const { ids } = await projectWithClips()
  const { PATCH } = await import('@/app/api/clips/[id]/route')
  const res = await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'kept' }) }), ctx({ id: ids[0] }))
  expect(res.status).toBe(200)
  const fb = await (await db()).clipFeedback.findMany()
  expect(fb).toHaveLength(1)
  expect(fb[0]).toMatchObject({ action: 'kept', contentType: 'podcast' })
  expect(fb[0].summary).toContain('T1')
  expect(fb[0].summary).toContain('Hello world.')
})

test('PATCH rejects bad status', async () => {
  const { ids } = await projectWithClips()
  const { PATCH } = await import('@/app/api/clips/[id]/route')
  expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'nope' }) }), ctx({ id: ids[0] }))).status).toBe(400)
})

test('range request returns 206 with the right bytes; source and transcript not served', async () => {
  const { p } = await projectWithClips()
  const m = join(dir, 'media', p.id)
  writeFileSync(join(m, 'proxy.mp4'), Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)))
  writeFileSync(join(m, 'source.mp4'), 'x')
  const cid = randomUUID(); mkdirSync(join(m, 'clips')); writeFileSync(join(m, 'clips', `${cid}.jpg`), 'j')
  const { GET } = await import('@/app/api/files/[...path]/route')
  const get = (path: string[], headers: Record<string, string> = {}) => GET(new Request('http://x', { headers }), ctx({ path }))
  const r = await get(['media', p.id, 'proxy.mp4'], { range: 'bytes=100-199' })
  expect(r.status).toBe(206)
  expect(r.headers.get('content-range')).toBe('bytes 100-199/1000')
  const b = new Uint8Array(await r.arrayBuffer())
  expect(b.length).toBe(100); expect(b[0]).toBe(100)
  expect((await get(['media', p.id, 'proxy.mp4'])).headers.get('accept-ranges')).toBe('bytes')
  expect((await get(['media', p.id, 'clips', `${cid}.jpg`])).status).toBe(200)
  expect((await get(['media', p.id, 'source.mp4'])).status).toBe(404)
  expect((await get(['media', p.id, 'transcript.json'])).status).toBe(404)
})

test('project view includes clipCount', async () => {
  const { p } = await projectWithClips()
  const { getProject } = await import('@/lib/projects')
  expect((await getProject(p.id))!.clipCount).toBe(2)
})

const validEdit = async () => {
  const { builtinPresets } = await import('@/lib/subtitle-presets')
  return { aspect: '9:16', layoutId: 'single', style: builtinPresets[5], subtitlesOn: true, watermarkOn: false,
    brand: { position: 'br', opacity: 80, sizePct: 12, marginPct: 4 }, trim: { start: 11, end: 39 }, resolution: '1080p' }
}
const patch = async (id: string, body: unknown) => {
  const { PATCH } = await import('@/app/api/clips/[id]/route')
  return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), ctx({ id }))
}

test('a clip saves its own edit and returns it', async () => {
  const { ids } = await projectWithClips()
  const edit = await validEdit()
  const res = await patch(ids[0], { edit })
  expect(res.status).toBe(200)
  expect((await res.json()).edit).toMatchObject({ layoutId: 'single', trim: { start: 11, end: 39 }, style: { id: 'boxed' } })
  const { getClip } = await import('@/lib/clip-views')
  expect((await getClip(ids[1]))!.edit).toBeUndefined() // per clip
})

test('invalid edits are rejected', async () => {
  const { ids } = await projectWithClips()
  const edit = await validEdit()
  expect((await patch(ids[0], { edit: { ...edit, trim: { start: 20, end: 20 } } })).status).toBe(400)
  expect((await patch(ids[0], { edit: { ...edit, layoutId: 'pip' } })).status).toBe(400) // needs facecam detection (Phase 7)
  expect((await patch(ids[0], { status: 'nope' })).status).toBe(400)
})

const post = async (mod: string, id: string, body: unknown) => {
  const { POST } = await import(mod)
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), ctx({ id }))
}

test('exporting a clip queues a render job with default editor settings, and leaves the project and clip alone', async () => {
  const { p, ids } = await projectWithClips()
  const d = await db()
  await d.project.update({ where: { id: p.id }, data: { status: 'ready', warning: 'keep' } })
  const res = await post('@/app/api/clips/[id]/export/route', ids[0], { resolution: '720p' })
  expect(res.status).toBe(200)
  const { jobId } = await res.json()
  const job = await d.job.findUniqueOrThrow({ where: { id: jobId } })
  expect(job.type).toBe('render')
  const payload = JSON.parse(job.payload!)
  expect(payload).toMatchObject({ clipIds: [ids[0]], resolution: '720p', zip: false })
  // defaults travel with the job; the clip itself stays untouched, so later Settings changes still apply to it
  expect(payload.edits[ids[0]]).toMatchObject({ aspect: '9:16', layoutId: 'single', trim: { start: 10, end: 40 }, style: { id: 'bold-pop' } })
  expect((await d.clip.findUniqueOrThrow({ where: { id: ids[0] } })).edit).toBeNull()
  expect(await d.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'ready', warning: 'keep' })
})

test('export all zips every clip that is not deleted; deleted or unknown clips are 404', async () => {
  const { p, ids } = await projectWithClips()
  const { jobId } = await (await post('@/app/api/projects/[id]/export/route', p.id, { resolution: '1080p' })).json()
  const job = await (await db()).job.findUniqueOrThrow({ where: { id: jobId } })
  expect(JSON.parse(job.payload!)).toMatchObject({ clipIds: [ids[1], ids[0]], resolution: '1080p', zip: true })
  expect((await post('@/app/api/clips/[id]/export/route', ids[2], { resolution: '1080p' })).status).toBe(404)
  expect((await post('@/app/api/clips/[id]/export/route', randomUUID(), { resolution: '1080p' })).status).toBe(404)
  expect((await post('@/app/api/clips/[id]/export/route', ids[0], { resolution: '4k' })).status).toBe(400)
})

test('job status lists download links once done', async () => {
  const { p, ids } = await projectWithClips()
  const { jobId } = await (await post('@/app/api/projects/[id]/export/route', p.id, { resolution: '1080p' })).json()
  const { GET } = await import('@/app/api/jobs/[id]/route')
  expect(await (await GET(new Request('http://x'), ctx({ id: jobId }))).json()).toMatchObject({ status: 'queued', files: [] })
  await (await db()).job.update({ where: { id: jobId }, data: { status: 'done', progress: 1 } })
  const done = await (await GET(new Request('http://x'), ctx({ id: jobId }))).json()
  expect(done.files).toEqual([`/api/files/renders/${p.id}-clips.zip?name=${encodeURIComponent(p.title)}`])
  expect((await GET(new Request('http://x'), ctx({ id: randomUUID() }))).status).toBe(404)
  expect(ids).toHaveLength(3)
})

test('renders download as attachments with safe names; nothing else in renders/ is served', async () => {
  const id = randomUUID()
  mkdirSync(join(dir, 'renders'), { recursive: true })
  writeFileSync(join(dir, 'renders', `${id}-1080p.mp4`), 'video')
  const { GET } = await import('@/app/api/files/[...path]/route')
  const get = (path: string[], q = '') => GET(new Request(`http://x/${q}`), ctx({ path }))
  const r = await get(['renders', `${id}-1080p.mp4`], '?name=A%2FB%3A%20%22Hi%22%20%F0%9F%8E%89')
  expect(r.status).toBe(200)
  expect(await r.text()).toBe('video')
  expect(r.headers.get('content-disposition')).toBe(`attachment; filename="A B Hi .mp4"; filename*=UTF-8''${encodeURIComponent('A B Hi 🎉.mp4')}`)
  expect((await get(['renders', '..', 'clipforge.db'])).status).toBe(404)
  expect((await get(['renders', '.fonts', 'inter-400.ttf'])).status).toBe(404)
  const { safeFilename } = await import('@/lib/filenames')
  expect(safeFilename('A/B: "Hi" 🎉', 'mp4')).toBe('A B Hi 🎉.mp4')
  expect(safeFilename('', 'zip')).toBe('clip.zip')
})

test('long titles with emoji near the cut-off still make a valid download name', async () => {
  const { safeFilename, attachment } = await import('@/lib/filenames')
  const name = safeFilename('x'.repeat(79) + '🎉 and more', 'zip')
  expect(name).toBe('x'.repeat(79) + '🎉.zip')
  expect(() => attachment(name)).not.toThrow()
})

test('an export never hijacks the project view, cancel, or Find clips again', async () => {
  const { p, ids } = await projectWithClips()
  const d = await db()
  const { writeFileSync: w } = await import('node:fs')
  w(join(dir, 'media', p.id, 'transcript.json'), JSON.stringify({ language: 'en', words: [] }))
  await d.job.updateMany({ where: { projectId: p.id }, data: { status: 'done' } })
  const { analyzeProject, cancelProject, getProject } = await import('@/lib/projects')
  await analyzeProject(p.id)
  await post('@/app/api/clips/[id]/export/route', ids[0], { resolution: '1080p' }) // newest job is now the render
  expect((await getProject(p.id))!.jobType).toBe('analyze')
  await cancelProject(p.id)
  const jobs = await d.job.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' } })
  expect(jobs.find((j) => j.type === 'render')!.status).toBe('queued')
  expect(jobs.find((j) => j.type === 'analyze')!.status).toBe('cancelled')
  // a queued export doesn't block Find clips again
  await d.project.update({ where: { id: p.id }, data: { status: 'ready' } })
  await expect(analyzeProject(p.id)).resolves.toBeTruthy()
})

test('an edit may leave out the brand kit (then the current Settings apply)', async () => {
  const { ids } = await projectWithClips()
  const edit: Record<string, unknown> = await validEdit()
  delete edit.brand
  const res = await patch(ids[0], { edit })
  expect(res.status).toBe(200)
  expect((await res.json()).edit.brand).toBeUndefined()
})

test('an unopened clip exports with fillers and pauses cut, zooms on the AI keywords; the AI hook line is written but off', async () => {
  const { p, ids } = await projectWithClips()
  writeFileSync(join(dir, 'media', p.id, 'silences.json'), JSON.stringify({ silences: [[20, 22], [100, 101]] }))
  const d = await db()
  await d.clip.update({ where: { id: ids[0] }, data: { hook: 'Nobody saw this coming', keywords: '["world"]' } })
  const { jobId } = await (await post('@/app/api/clips/[id]/export/route', ids[0], { resolution: '1080p' })).json()
  const e = JSON.parse((await d.job.findUniqueOrThrow({ where: { id: jobId } })).payload!).edits[ids[0]]
  expect(e).toMatchObject({ removeFillers: true, removePauses: true, autoZoom: true, bumpers: true, hook: { on: false, text: 'Nobody saw this coming' } })
  expect(e.keep).toEqual([[10, 20.12], [21.88, 40]])
  expect(e.zooms).toEqual([[10.5, 11.5]])
  const { jobId: j2 } = await (await post('@/app/api/clips/[id]/export/route', ids[1], { resolution: '1080p' })).json()
  expect(JSON.parse((await d.job.findUniqueOrThrow({ where: { id: j2 } })).payload!).edits[ids[1]].hook.text).toBe('T1') // no AI hook: first title
})

test('an edit saves the auto-edit switches with its cut list; edits from before Phase 4b still load', async () => {
  const { ids } = await projectWithClips()
  const edit = { ...(await validEdit()), removeFillers: false, removePauses: true, autoZoom: false, hook: { on: true, text: 'Hi' }, bumpers: false, keep: [[11, 20], [21, 39]], zooms: [] }
  expect((await (await patch(ids[0], { edit })).json()).edit).toMatchObject({ removeFillers: false, keep: [[11, 20], [21, 39]], hook: { text: 'Hi' } })
  expect((await patch(ids[1], { edit: await validEdit() })).status).toBe(200)
  expect((await patch(ids[1], { edit: { ...edit, hook: { on: true, text: 'x'.repeat(200) } } })).status).toBe(400)
})

test('the clip view carries the AI hook and keywords', async () => {
  const { ids } = await projectWithClips()
  await (await db()).clip.update({ where: { id: ids[0] }, data: { hook: 'H', keywords: '["a","b"]' } })
  const { getClip } = await import('@/lib/clip-views')
  expect(await getClip(ids[0])).toMatchObject({ hook: 'H', keywords: ['a', 'b'] })
  expect((await getClip(ids[1]))!.keywords).toEqual([])
})

test('speaker layouts can be saved; a video with two people talking exports in Active speaker by default', async () => {
  const { p, ids } = await projectWithClips()
  for (const layoutId of ['active-speaker', 'split', 'grid']) expect((await patch(ids[0], { edit: { ...(await validEdit()), layoutId } })).status).toBe(200)
  const people = { track: [[0, 0.5, 0.5]], faceH: 0.2, multi: true, speakers: [0, 1], split: { ranges: [], tracks: {} }, grid: { ranges: [], tracks: {} } }
  writeFileSync(join(dir, 'media', p.id, 'people.json'), JSON.stringify(people))
  const { jobId } = await (await post('@/app/api/clips/[id]/export/route', ids[1], { resolution: '1080p' })).json()
  expect(JSON.parse((await (await db()).job.findUniqueOrThrow({ where: { id: jobId } })).payload!).edits[ids[1]].layoutId).toBe('active-speaker')
  const { GET } = await import('@/app/api/files/[...path]/route')
  expect((await GET(new Request('http://x'), ctx({ path: ['media', p.id, 'people.json'] }))).status).toBe(200)
})
