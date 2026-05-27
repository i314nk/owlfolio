import { expect, test } from '@playwright/test'

test('demo onboarding shows workflow command center and research statuses', async ({ page }) => {
  await page.goto('/onboarding')

  await expect(page.getByRole('heading', { name: /set up owlfolio/i })).toBeVisible()

  const demoModeCard = page.getByRole('article').filter({ hasText: /demo mode/i })
  await expect(demoModeCard.getByText('Demo mode', { exact: true })).toBeVisible()
  await expect(demoModeCard.getByText(/provider: mock provider \/ demo mode/i)).toBeVisible()
  await expect(demoModeCard.getByText(/strategy: buffett-munger/i)).toBeVisible()
  await expect(demoModeCard.getByText(/shariah: enabled by default/i)).toBeVisible()

  await expect(page.getByRole('article').filter({ hasText: /personal local mode/i })).toContainText(/coming later|disabled/i)

  await page.getByRole('link', { name: /start demo/i }).click()

  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
  await expect(page.getByText(/provider.*mock provider/i)).toBeVisible()
  await expect(page.getByText(/strategy.*buffett-munger/i)).toBeVisible()
  await expect(page.getByText(/shariah.*enabled/i)).toBeVisible()

  await page.getByRole('link', { name: /view demo research case/i }).click()

  await expect(page.getByRole('heading', { name: /cost/i })).toBeVisible()
  await expect(page.getByText(/investment verdict.*watch/i)).toBeVisible()
  await expect(page.getByText(/strategy compliance.*conditional/i)).toBeVisible()
  await expect(page.getByText(/shariah status.*compliant/i)).toBeVisible()
  await expect(page.getByText(/valuation status/i)).toBeVisible()
})
