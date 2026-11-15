import { expect, test, type Page } from '@playwright/test'

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

const ROUTES: [string, RegExp][] = [
  ['/', /Projects/],
  ['/new', /New project/],
  ['/projects/p-processing/processing', /How I edit/],
  ['/projects/p-podcast/clips', /Founders Talk/],
]

for (const [path, h1] of ROUTES) {
  test(`routes render ${path}`, async ({ page }) => {
    const errors = trackErrors(page)
    const res = await page.goto(path)
    expect(res?.status()).toBe(200)
    await expect(page.locator('h1')).toHaveText(h1)
    expect(errors).toEqual([])
  })
}

test('library empty state', async ({ page }) => {
  await page.goto('/?empty=1')
  await expect(page.getByText('No projects yet')).toBeVisible()
})

test('sort by score', async ({ page }) => {
  await page.goto('/projects/p-podcast/clips')
  await page.getByRole('radio', { name: 'Time' }).click()
  await page.getByRole('radio', { name: 'Score' }).click()
  const badges = page.getByTestId('score-badge')
  const [a, b] = [Number(await badges.nth(0).innerText()), Number(await badges.nth(1).innerText())]
  expect(a).toBeGreaterThanOrEqual(b)
})

test('min score filter hides low clips', async ({ page }) => {
  await page.goto('/projects/p-podcast/clips')
  const before = await page.getByTestId('score-badge').count()
  const slider = page.getByLabel('Minimum score')
  await slider.focus()
  await page.keyboard.press('End')
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft') // 100 → 80 in steps of 5
  await expect(page.getByTestId('score-badge')).toHaveCount(3)
  expect(before).toBe(10)
})

test('new project submit goes to processing demo', async ({ page }) => {
  await page.goto('/new')
  await page.getByPlaceholder(/youtube/i).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Create clips' }).click()
  await expect(page).toHaveURL(/\/projects\/p-processing\/processing/)
})

test('theme toggle', async ({ page }) => {
  await page.goto('/')
  const before = await page.locator('html').getAttribute('class')
  await page.getByTestId('theme-toggle').click()
  const after = await page.locator('html').getAttribute('class')
  expect(before?.includes('dark')).not.toBe(after?.includes('dark'))
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })
  for (const path of ['/', '/projects/p-podcast/clips', '/settings/ai']) {
    test(`mobile no overflow ${path}`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    })
  }
})
