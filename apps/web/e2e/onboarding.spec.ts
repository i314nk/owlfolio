import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('demo onboarding initializes the durable demo workflow', async ({ page }) => {
  await page.goto('/onboarding')

  await expect(page.getByRole('heading', { name: /set up owlfolio/i })).toBeVisible()
  await expect(page.getByText(/choose mode/i)).toBeVisible()
  await expect(page.getByRole('radio', { name: /demo mode/i })).toBeChecked()
  await expect(page.getByText(/ready for deterministic demo mode/i).first()).toBeVisible()

  await page.getByRole('button', { name: /start workflow/i }).click()

  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
  await expect(page.getByText(/setup ready/i)).toBeVisible()
  await expect(page.getByText(/provider: mock provider \/ demo mode/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /view demo research case/i })).toBeVisible()
})

test('personal local onboarding shows unready provider status and disables workflow start', async ({ page }) => {
  await page.goto('/onboarding')

  await page.getByRole('radio', { name: /personal local mode/i }).click()

  await expect(page.getByText(/subscription access|missing claude credentials/i).first()).toBeVisible()
  await expect(page.getByText(/auth source: certification report|auth source: missing/i).first()).toBeVisible()
  await expect(page.getByText('Provider cannot start yet', { exact: true })).toBeVisible()
  await expect(page.getByText(/start workflow disabled until claude is ready/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /start workflow disabled until claude is ready/i })).toBeDisabled()
  await expect(page.getByRole('heading', { name: /set up owlfolio/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /command center/i })).not.toBeVisible()
})
