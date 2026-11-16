import { expect, test, type APIRequestContext } from '@playwright/test'
import { makeSpeechVideo } from './fixtures'

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const SPEECH = 'Welcome back to the show. Today I want to tell you a story about the time we set up our students on blind dates for science. ' +
  'It sounds crazy, right? But the class was actually a research study about loneliness. We measured stress before and after nine weeks. ' +
  'The results surprised everyone, including me. People who made one new friend felt dramatically better. ' +
  'So here is my advice. Put your phone down tonight and call someone you miss. It might be the most important thing you do this week. ' +
  'And that is why I believe connection is the real medicine. Thank you for listening, and see you next time on the pipeline podcast.'

let video: string
async function useFakeModel(request: APIRequestContext, on = true) {
  await request.put('/api/providers/custom', { data: { baseUrl: 'http://127.0.0.1:3199/v1', enabled: true } })
  const m = on ? { provider: 'custom', model: 'fake' } : null
  await request.put('/api/settings/aiTasks', { data: { highlight: m, scoring: m, titles: m, vision: null } })
  const d = await (await request.get('/api/settings/defaults')).json()
  await request.put('/api/settings/defaults', { data: { ...d, lengthRange: [15, 60] } })
}
async function uploadVideo(page: import('@playwright/test').Page) {
  await page.goto('/new')
  await page.locator('input[type=file]').setInputFiles(video)
  await page.getByRole('button', { name: 'Create clips' }).click()
  await expect(page).toHaveURL(/\/processing/, { timeout: 30_000 })
}

test.beforeAll(async ({ request }) => { video = makeSpeechVideo(SPEECH); await useFakeModel(request) })

test('upload → clips with scores, thumbnails and titles', async ({ page }) => {
  await uploadVideo(page)
  await expect(page.getByText(/Finding clips|Listening for reactions/).first()).toBeVisible({ timeout: 150_000 })
  await expect(page).toHaveURL(/\/clips$/, { timeout: 150_000 })
  const cards = page.getByTestId('clip-card')
  await expect(cards.first()).toBeVisible()
  await expect(cards.first().getByTestId('score-badge')).toBeVisible()
  await expect(cards.first().locator('img')).toHaveAttribute('src', /\/clips\/.+\.jpg/)
  await expect(cards.first()).toContainText(/Title \d+ v1/)
})

test('details show the reason for each score and regenerate changes titles', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('project-card').filter({ hasText: 'speech-test' }).first().click()
  await expect(page).toHaveURL(/\/clips$/)
  await page.getByTestId('clip-card').first().getByRole('button', { name: /^Open/ }).click()
  await expect(page.getByText('Opens strong with a question')).toBeVisible()
  const before = await page.getByTestId('titles-list').innerText()
  await page.getByRole('button', { name: 'Regenerate Titles' }).click()
  await expect(page.getByTestId('titles-list')).not.toHaveText(before, { timeout: 15_000 })
})

test('keep one, delete one, find clips again keeps the kept clip', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('project-card').filter({ hasText: 'speech-test' }).first().click()
  const cards = page.getByTestId('clip-card')
  const keptId = await cards.nth(0).getAttribute('data-clip-id')
  await cards.nth(0).getByRole('button', { name: 'Keep' }).click()
  await expect(cards.nth(0).getByRole('button', { name: 'Kept' })).toBeVisible()
  const deletedId = await cards.nth(1).getAttribute('data-clip-id')
  await cards.nth(1).getByRole('button', { name: 'Delete' }).click()
  await cards.nth(1).getByRole('button', { name: 'Yes' }).click()
  await expect(page.locator(`[data-clip-id="${deletedId}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Find clips again' }).click()
  await expect(page.locator(`[data-clip-id="${keptId}"]`)).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/Finding clips/).first()).toBeHidden({ timeout: 120_000 })
  await expect(page.locator(`[data-clip-id="${keptId}"]`)).toBeVisible()
})

test('search finds a moment, and says so when nothing matches', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('project-card').filter({ hasText: 'speech-test' }).first().click()
  await page.getByPlaceholder(/Find a moment/).fill('pipeline podcast')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText('Found for “pipeline podcast”').first()).toBeVisible({ timeout: 120_000 })
  await page.getByPlaceholder(/Find a moment/).fill('dinosaurs')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText('No moment matched “dinosaurs”')).toBeVisible({ timeout: 120_000 })
})

test('a project transcribed without a model gets a Find clips button that works once a model is set', async ({ page, request }) => {
  await useFakeModel(request, false)
  await uploadVideo(page)
  await expect(page).toHaveURL(/\/transcript$/, { timeout: 150_000 })
  await expect(page.getByText('Set a model in Settings → AI to find clips').first()).toBeVisible()
  await useFakeModel(request, true)
  await page.getByRole('button', { name: 'Find clips' }).click()
  await expect(page).toHaveURL(/\/clips$/, { timeout: 150_000 })
  await expect(page.getByTestId('clip-card').first()).toBeVisible()
})
