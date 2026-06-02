import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('default home page renders the demo command center and research workflow pages', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
  await expect(page.getByText(/provider: mock provider \/ demo mode/i)).toBeVisible()
  await expect(page.getByText(/strategy: buffett-munger certified/i)).toBeVisible()
  await expect(page.getByText(/view demo research case/i)).toBeVisible()

  await page.getByRole('link', { name: /view demo research case/i }).click()

  await expect(page.getByRole('heading', { name: /cost/i })).toBeVisible()
  await expect(page.getByText(/investment verdict.*watch/i)).toBeVisible()
  await expect(page.getByText(/strategy compliance.*conditional/i)).toBeVisible()
  await expect(page.getByText('Shariah status: COMPLIANT', { exact: true })).toBeVisible()
  await expect(page.getByText(/valuation status/i)).toBeVisible()
})
