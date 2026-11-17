import { expect, test, type Page } from '@playwright/test'
import { makeSpeechVideo } from './fixtures'

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const SPEECH = 'Today I want to tell you a story about the time we set up our students on blind dates for science. ' +
  'It sounds crazy, right? But the class was a research study about loneliness, and the results surprised everyone. ' +
  'People who made one new friend felt dramatically better. So put your phone down tonight and call someone you miss.'

let editorUrl = ''

test.beforeAll(async ({ request }) => {
  await request.put('/api/providers/custom', { data: { baseUrl: 'http://127.0.0.1:3199/v1', enabled: true } })
  const m = { provider: 'custom', model: 'fake' }
  await request.put('/api/settings/aiTasks', { data: { highlight: m, scoring: m, titles: m, vision: null } })
  const d = await (await request.get('/api/settings/defaults')).json()
  await request.put('/api/settings/defaults', { data: { ...d, lengthRange: [15, 60] } })
})

const frame = (page: Page) => page.getByTestId('canvas-frame')

test('a real clip opens in the editor with its video and the face track', async ({ page }) => {
  await page.goto('/new')
  await page.locator('input[type=file]').setInputFiles(makeSpeechVideo(SPEECH))
  await page.getByRole('button', { name: 'Create clips' }).click()
  await expect(page).toHaveURL(/\/clips$/, { timeout: 200_000 })
  const pid = /projects\/([0-9a-f-]{36})\//.exec(page.url())![1]
  const clipId = await page.getByTestId('clip-card').first().getAttribute('data-clip-id')
  editorUrl = `/editor/${pid}/${clipId}`
  expect((await page.request.get(`/api/files/media/${pid}/track.json`)).ok()).toBe(true)

  await page.goto(editorUrl)
  const video = frame(page).getByTestId('clip-video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  const clip = await (await page.request.get(`/api/clips/${clipId}`)).json()
  const t = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
  expect(t).toBeGreaterThanOrEqual(clip.startSec - 0.1)
  expect(t).toBeLessThanOrEqual(clip.endSec)
})

test('subtitles are drawn by libass on a canvas over the video, with the bundled fonts', async ({ page }) => {
  const misses: string[] = []
  page.on('console', (m) => { if (/fontselect: failed/.test(m.text())) misses.push(m.text()) })
  await page.goto(editorUrl)
  const overlay = frame(page).getByTestId('ass-overlay')
  await expect(overlay).toHaveAttribute('data-ready', '1', { timeout: 20_000 })
  const clip = await (await page.request.get(`/api/clips/${editorUrl.split('/').pop()}`)).json()
  const word = clip.transcript[2] // mid-word, so a subtitle must be on screen
  await frame(page).getByTestId('clip-video').evaluate((v: HTMLVideoElement, t: number) => { v.currentTime = t }, (word.s + word.e) / 2)
  await page.waitForTimeout(800)
  const on = await frame(page).screenshot()
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click()
  await page.getByRole('switch', { name: /subtitles/i }).first().click()
  await page.waitForTimeout(500)
  const off = await frame(page).screenshot()
  expect(on.equals(off)).toBe(false)
  expect(misses).toEqual([]) // a font libass can't find renders as empty boxes
})

test('choosing a preset is saved with the clip', async ({ page }) => {
  await page.goto(editorUrl)
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click()
  await page.getByRole('button', { name: /Boxed/ }).first().click()
  await page.waitForTimeout(1500) // autosave debounce
  await page.reload()
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click()
  await expect(page.getByRole('button', { name: /Boxed/ }).first()).toHaveAttribute('aria-pressed', 'true')
})

test('only layouts that work for this video can be picked', async ({ page }) => {
  await page.goto(editorUrl)
  await page.getByRole('button', { name: 'Layout', exact: true }).click()
  await expect(page.locator('[data-layout=single]')).toBeEnabled()
  await expect(page.locator('[data-layout=wide-blur]')).toBeEnabled()
  await expect(page.locator('[data-layout=split]')).toBeDisabled()
  await page.locator('[data-layout=wide-blur]').click()
  await expect(frame(page).getByTestId('clip-video-blur')).toBeVisible()
})

test('a change made right before leaving the editor is still saved', async ({ page }) => {
  await page.goto(editorUrl)
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click()
  await page.getByRole('button', { name: /Neon/ }).first().click()
  await page.goto('/') // immediately: before the autosave delay
  await page.goto(editorUrl)
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click()
  await expect(page.getByRole('button', { name: /Neon/ }).first()).toHaveAttribute('aria-pressed', 'true')
})

test('auto edits: cuts on and the hook line off by default; changes are saved with the clip', async ({ page }) => {
  const id = editorUrl.split('/').pop()
  await page.goto(editorUrl)
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  for (const name of ['Remove filler words (um, uh)', 'Remove long pauses']) await expect(page.getByRole('switch', { name })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Hook line at the start' })).not.toBeChecked()
  await page.getByRole('switch', { name: 'Hook line at the start' }).click()
  await expect(page.getByRole('textbox', { name: 'Hook text' })).not.toHaveValue('')
  const edit = async () => (await (await page.request.get(`/api/clips/${id}`)).json()).edit
  await page.getByRole('textbox', { name: 'Hook text' }).fill('Watch till the end')
  await expect.poll(async () => (await edit())?.hook).toEqual({ on: true, text: 'Watch till the end' })
  await page.getByRole('switch', { name: 'Remove filler words (um, uh)' }).click()
  await page.getByRole('switch', { name: 'Remove long pauses' }).click()
  await page.getByRole('switch', { name: 'Hook line at the start' }).click()
  await expect.poll(async () => { const e = await edit(); return [e.hook.on, e.removePauses, e.keep] })
    .toEqual([false, false, [[expect.any(Number), expect.any(Number)]]]) // nothing cut: the whole trim plays
  await expect(page.getByTestId('timeline-cut')).toHaveCount(0)
})

test('speaker layouts: offered when speakers were found; split/grid need two people on screen', async ({ page }) => {
  await page.goto(editorUrl)
  await page.getByRole('button', { name: 'Layout', exact: true }).click()
  await expect(page.locator('[data-layout=active-speaker]')).toBeEnabled() // the test video: one voice, one face
  await expect(page.locator('[data-layout=split]')).toBeDisabled()
  await expect(page.locator('[data-layout=split]')).toContainText('Needs 2+ people on screen together')
  await page.getByRole('textbox', { name: 'Template name' }).fill('My podcast')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'My podcast' })).toBeVisible()
})

test('transcript editing: cut words out, fix a word, trim to a selection; frame nudges move the trim', async ({ page }) => {
  await page.goto(editorUrl)
  const words = page.getByTestId('transcript-word')
  await expect(words.first()).toBeVisible()
  const inClip = page.locator('[data-testid=transcript-word]:not([data-cut])')
  const n = await words.count()
  expect(n).toBeGreaterThan(6)
  // cut two words in the middle of the clip
  const mid = Math.floor(n / 2)
  await words.nth(mid).click()
  await words.nth(mid + 1).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Cut', exact: true }).click()
  await expect(page.getByText(/1 part cut by hand/)).toBeVisible()
  // fix what Whisper heard
  await words.nth(1).dblclick()
  await page.getByLabel('Fix word').fill('ClipForge')
  await page.keyboard.press('Enter')
  await expect(words.nth(1)).toHaveText('ClipForge')
  // frame nudge
  const start = await page.getByTestId('trim-start').textContent()
  await page.getByRole('button', { name: 'Start one frame later' }).click()
  await expect(page.getByTestId('trim-start')).not.toHaveText(start!)
  await page.waitForTimeout(1500) // autosave
  const clip = await (await page.request.get(`/api/clips/${editorUrl.split('/').pop()}`)).json()
  expect(clip.edit.cuts).toHaveLength(1)
  expect(clip.edit.words.some((w: { w: string }) => w.w === 'ClipForge')).toBe(true)
  expect(clip.edit.keep.length).toBeGreaterThan(1)
  expect(await inClip.count()).toBeGreaterThan(0)
})
