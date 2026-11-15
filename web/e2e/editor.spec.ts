import { expect, test } from '@playwright/test'

const PODCAST = '/editor/p-podcast/p-podcast-c1'
const GAMING = '/editor/p-gaming/p-gaming-c1'
test.use({ viewport: { width: 1440, height: 900 } })

test('rail order', async ({ page }) => {
  await page.goto(PODCAST)
  await expect(page.getByTestId('rail').getByRole('button')).toHaveText(['Clips', 'Layout', 'Subtitles', 'Branding', 'AI', 'Export', 'Settings'])
})

test('undo redo', async ({ page }) => {
  await page.goto(PODCAST)
  const aspect = (name: string) => page.getByRole('radiogroup', { name: 'Aspect ratio' }).getByRole('radio', { name })
  await aspect('1:1').click()
  await expect(aspect('1:1')).toHaveAttribute('aria-checked', 'true')
  await page.locator('body').click({ position: { x: 5, y: 450 } })
  await page.keyboard.press('ControlOrMeta+z')
  await expect(aspect('9:16')).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(aspect('1:1')).toHaveAttribute('aria-checked', 'true')
})

test('transcript edit live', async ({ page }) => {
  await page.goto(PODCAST)
  await page.getByTestId('rail').getByRole('button', { name: 'Subtitles' }).click()
  await page.getByLabel('Word 1', { exact: true }).fill('hello')
  await expect(page.getByTestId('canvas-subtitle').first()).toContainText(/hello/i)
})

test('watermark position', async ({ page }) => {
  await page.goto(PODCAST)
  await page.getByTestId('rail').getByRole('button', { name: 'Branding' }).click()
  await page.getByRole('radio', { name: 'Top left' }).click()
  const frame = (await page.getByTestId('canvas-frame').first().boundingBox())!
  const wm = (await page.getByTestId('canvas-watermark').first().boundingBox())!
  expect(wm.x + wm.width / 2).toBeLessThan(frame.x + frame.width / 2)
  expect(wm.y + wm.height / 2).toBeLessThan(frame.y + frame.height / 2)
})

test('layout thumbs', async ({ page }) => {
  await page.goto(PODCAST)
  await page.getByTestId('rail').getByRole('button', { name: 'Layout' }).click()
  expect(await page.getByTestId('layout-card').count()).toBeGreaterThanOrEqual(4)
  await page.goto(GAMING)
  await page.getByTestId('rail').getByRole('button', { name: 'Layout' }).click()
  await expect(page.locator('[data-testid=layout-card][data-layout=facecam-top]')).toBeVisible()
})

test('small screens get a notice', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await page.goto(PODCAST)
  await expect(page.getByText('Open the editor on a larger screen')).toBeVisible()
})
