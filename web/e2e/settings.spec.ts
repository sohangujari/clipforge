import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

let ollamaModels: string[] = []
test.beforeAll(async () => {
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) })
    ollamaModels = ((await r.json()).models ?? []).map((m: { name: string }) => m.name)
  } catch { /* Ollama not running */ }
})

test('ollama live', async ({ page }) => {
  test.skip(!ollamaModels.length, 'Ollama not running')
  await page.goto('/settings/ai')
  const card = page.getByTestId('provider-ollama')
  await card.getByRole('button', { name: 'Test connection' }).click()
  await expect(card.getByText(/Connected/)).toBeVisible({ timeout: 10_000 })
  await card.getByRole('combobox', { name: 'Ollama (local) model' }).click()
  await expect(page.getByRole('option', { name: new RegExp(ollamaModels[0].replace(/[.:]/g, '\\$&')) })).toBeVisible()
})

test('custom model id', async ({ page }) => {
  await page.goto('/settings/ai')
  await page.getByRole('combobox', { name: 'Highlight detection model' }).click()
  await page.getByPlaceholder('Search or type a model ID').fill('my-model:latest')
  await page.getByRole('option', { name: /Add custom model ID/ }).click()
  await expect(page.getByRole('combobox', { name: 'Highlight detection model' })).toHaveText(/my-model:latest/)
})

test('test is disabled until typed changes are saved', async ({ page }) => {
  await page.goto('/settings/ai')
  const card = page.getByTestId('provider-anthropic')
  await card.getByLabel('API key').fill('sk-ant-unsaved')
  await expect(card.getByRole('button', { name: 'Test connection' })).toBeDisabled()
  await expect(card.getByText('Save first to test these values')).toBeVisible()
})

test('key masked', async ({ page }) => {
  await page.goto('/settings/ai')
  const card = page.getByTestId('provider-openai')
  await card.getByLabel('API key').fill('sk-test-abcd1234')
  await card.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('OpenAI saved')).toBeVisible()
  await page.reload()
  const input = page.getByTestId('provider-openai').getByLabel('API key')
  await expect(input).toHaveValue('')
  await expect(input).toHaveAttribute('placeholder', /1234/)
  expect(await page.content()).not.toContain('sk-test-abcd1234')
})

test('ollama down message', async ({ page }) => {
  await page.goto('/settings/ai')
  const card = page.getByTestId('provider-ollama')
  await card.getByLabel('Base URL').fill('http://127.0.0.1:9')
  await card.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Ollama (local) saved')).toBeVisible()
  await card.getByRole('button', { name: 'Test connection' }).click()
  await expect(card.getByText(/ollama serve/)).toBeVisible({ timeout: 7_000 })
})

test('defaults persist', async ({ page }) => {
  await page.goto('/settings/defaults')
  await page.getByRole('combobox', { name: 'Tone' }).click()
  await page.getByRole('option', { name: 'Funny' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Defaults saved')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Tone' })).toHaveText('Funny')
})

test('subtitle default preset', async ({ page }) => {
  await page.goto('/settings/subtitles')
  await page.getByTestId('preset-neon').getByRole('button', { name: 'Set default' }).click()
  await page.reload()
  await expect(page.getByTestId('preset-neon').getByText('Default')).toBeVisible()
})

test('brand kit logo upload', async ({ page }) => {
  await page.goto('/settings/brand')
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
  await page.getByLabel('Upload logo').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: svg })
  await expect(page.getByAltText('Your logo')).toBeVisible()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Brand kit saved')).toBeVisible()
  await page.reload()
  await expect(page.getByAltText('Your logo')).toBeVisible()
})

test('every settings section renders', async ({ page }) => {
  for (const s of ['ai', 'brand', 'subtitles', 'layouts', 'defaults', 'profile']) {
    const res = await page.goto(`/settings/${s}`)
    expect(res?.status()).toBe(200)
    await expect(page.locator('h1')).toHaveText('Settings')
  }
})

test('shows requests made today', async ({ page }) => {
  await page.goto('/settings/ai')
  await expect(page.getByTestId('usage-today')).toContainText('Requests today')
})
