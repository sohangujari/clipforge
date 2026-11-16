import { expect, test } from '@playwright/test'
import { makeSpeechVideo, slowServer } from './fixtures'

test.describe.configure({ mode: 'serial' })
let video: string
test.beforeAll(async ({ request }) => {
  video = makeSpeechVideo()
  // These tests cover import + transcription only: no AI model, so finished projects land on the transcript page.
  await request.put('/api/settings/aiTasks', { data: { highlight: null, scoring: null, titles: null, vision: null } })
})

test('upload → transcript', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/new')
  await page.locator('input[type=file]').setInputFiles(video)
  await expect(page.getByText('speech-test.mp4')).toBeVisible()
  await page.getByRole('button', { name: 'Create clips' }).click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/processing/, { timeout: 30_000 })
  await expect(page.getByText(/Preparing|Transcribing/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/transcript$/, { timeout: 150_000 })
  await expect(page.getByTestId('transcript')).toContainText(/clip/i)
})

test('library shows the real project with a thumbnail and the demos separately', async ({ page }) => {
  await page.goto('/')
  const card = page.getByTestId('project-card').filter({ hasText: 'speech-test' }).first()
  await expect(card).toBeVisible()
  await expect(card.locator('img')).toHaveAttribute('src', /thumb\.jpg/)
  await expect(page.getByRole('heading', { name: 'Demo projects' })).toBeVisible()
})

test('bad link message', async ({ page }) => {
  await page.goto('/new')
  await page.getByPlaceholder(/youtube/i).fill('notaurl')
  await page.getByRole('button', { name: 'Create clips' }).click()
  await expect(page.getByText('Paste a full link starting with https://')).toBeVisible()
})

test('cancel a download, then retry', async ({ page }) => {
  const { url, server } = await slowServer(video)
  try {
    await page.goto('/new')
    await page.getByPlaceholder(/youtube/i).fill(url)
    await page.getByRole('button', { name: 'Create clips' }).click()
    await expect(page).toHaveURL(/\/processing/)
    await expect(page.getByText('Downloading').first()).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Cancelled').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  } finally { server.close() }
})

test('unreachable link fails with a readable message', async ({ page }) => {
  await page.goto('/new')
  await page.getByPlaceholder(/youtube/i).fill('http://127.0.0.1:9/nothing.mp4')
  await page.getByRole('button', { name: 'Create clips' }).click()
  await expect(page.getByText(/Couldn't reach the site|Download failed/)).toBeVisible({ timeout: 30_000 })
})

test('vocabulary chips', async ({ page }) => {
  await page.goto('/new')
  const input = page.getByLabel('Custom words')
  await input.fill('Sohan,')
  await expect(page.getByTestId('vocab-chip').filter({ hasText: 'Sohan' })).toBeVisible()
  await input.fill('ClipForge')
  await input.press('Enter')
  await expect(page.getByTestId('vocab-chip')).toHaveCount(2)
})
