import { expect, test } from '@playwright/test'
import { makeSpeechVideo } from './fixtures'

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const SPEECH = 'Today I want to tell you a story about the time we set up our students on blind dates for science. ' +
  'It sounds crazy, right? But the class was a research study about loneliness, and the results surprised everyone. ' +
  'People who made one new friend felt dramatically better. So put your phone down tonight and call someone you miss.'

let pid = '', clipId = ''

test.beforeAll(async ({ request }) => {
  await request.put('/api/providers/custom', { data: { baseUrl: 'http://127.0.0.1:3199/v1', enabled: true } })
  const m = { provider: 'custom', model: 'fake' }
  await request.put('/api/settings/aiTasks', { data: { highlight: m, scoring: m, titles: m, vision: null } })
  const d = await (await request.get('/api/settings/defaults')).json()
  await request.put('/api/settings/defaults', { data: { ...d, lengthRange: [15, 60] } })
})

test('export a clip from the editor and download the MP4', async ({ page }) => {
  await page.goto('/new')
  await page.locator('input[type=file]').setInputFiles(makeSpeechVideo(SPEECH))
  await page.getByRole('button', { name: 'Create clips' }).click()
  await expect(page).toHaveURL(/\/clips$/, { timeout: 200_000 })
  pid = /projects\/([0-9a-f-]{36})\//.exec(page.url())![1]
  clipId = (await page.getByTestId('clip-card').first().getAttribute('data-clip-id'))!

  await page.goto(`/editor/${pid}/${clipId}`)
  await page.getByRole('button', { name: 'Export', exact: true }).last().click() // rail section
  await page.getByRole('radio', { name: '720p' }).click()
  await page.getByRole('button', { name: 'Export clip' }).click()
  const link = page.getByRole('link', { name: 'Download MP4' })
  await expect(link).toBeVisible({ timeout: 120_000 })
  const res = await page.request.get((await link.getAttribute('href'))!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('video/mp4')
  expect(res.headers()['content-disposition']).toMatch(/^attachment; filename=".+\.mp4"/)
  expect((await res.body()).length).toBeGreaterThan(10_000)
})

test('download all clips as a ZIP from the clips page', async ({ page }) => {
  await page.goto(`/projects/${pid}/clips`)
  await page.getByRole('button', { name: 'Download all (ZIP)' }).click()
  const link = page.getByRole('link', { name: 'Download ZIP' })
  await expect(link).toBeVisible({ timeout: 180_000 })
  const res = await page.request.get((await link.getAttribute('href'))!)
  expect(res.headers()['content-type']).toBe('application/zip')
  expect((await res.body()).subarray(0, 2).toString()).toBe('PK')
})

test('a clip can be exported from its details on the clips page', async ({ page }) => {
  await page.goto(`/projects/${pid}/clips`)
  await page.getByTestId('clip-card').first().getByRole('button', { name: /^Open/ }).click()
  await page.getByRole('button', { name: 'Export clip' }).click()
  await expect(page.getByRole('link', { name: 'Download MP4' })).toBeVisible({ timeout: 120_000 })
})
