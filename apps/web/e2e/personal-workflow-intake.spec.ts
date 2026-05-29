import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('personal-local mode can create the first research case from the command center', async ({ page }) => {
  await page.goto('/onboarding')
  await page.getByRole('radio', { name: /personal local mode/i }).click()
  await page.getByRole('combobox').selectOption('mock-provider')
  await page.getByRole('button', { name: /start workflow/i }).click()

  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: /start first research case/i }).click()
  await expect(page).toHaveURL('/research/new')

  await page.getByLabel('Ticker').fill('MSFT')
  await page.getByRole('button', { name: /create research case/i }).click()

  await expect(page).toHaveURL(/\/research\/rc_msft_/)
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
  await expect(page.getByText(/decision_drafted/i).first()).toBeVisible()
  await expect(page.getByText(/watch/i).first()).toBeVisible()
  await expect(page.getByText(/conditional/i).first()).toBeVisible()
})
