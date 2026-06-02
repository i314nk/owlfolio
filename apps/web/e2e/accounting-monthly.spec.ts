import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('monthly accounting report renders projected current period after a valuation snapshot', async ({ page }) => {
  await page.goto('/onboarding')
  await page.getByRole('radio', { name: /personal local mode/i }).click()
  await page.getByRole('combobox').selectOption('mock-provider')
  await page.getByRole('button', { name: /start workflow/i }).click()

  await page.getByRole('link', { name: /start first research case/i }).click()
  await page.getByLabel('Ticker').fill('MSFT')
  await page.getByRole('button', { name: /create research case/i }).click()
  await expect(page).toHaveURL(/\/research\/rc_msft_/)
  const researchCaseId = new URL(page.url()).pathname.split('/').at(-1)
  expect(researchCaseId).toMatch(/^rc_msft_/)

  await page.getByRole('button', { name: /promote to watchlist/i }).click()
  await page.getByRole('button', { name: /confirm watchlist draft/i }).click()
  await page.getByLabel('Shares').fill('3.25')
  await page.getByLabel('Cost basis per share').fill('812.40')
  await page.getByLabel('Opened date').fill('2026-05-31')
  await page.getByRole('button', { name: /record initial holding/i }).click()

  await page.goto('/portfolio')
  await page.getByLabel('Current price per share').fill('900')
  await page.getByLabel('Valuation date').fill('2026-06-01')
  await page.getByRole('button', { name: /record valuation snapshot/i }).click()

  await page.goto('/accounting/monthly')
  await expect(page.getByRole('heading', { name: /monthly accounting report/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Current period summary' })).toBeVisible()
  await expect(page.getByText('NAV', { exact: true })).toBeVisible()
  await expect(page.getByText('$2,925.00').first()).toBeVisible()
  await expect(page.getByText('MSFT').first()).toBeVisible()
  await expect(page.getByText('Latest valuation: 2026-06-01')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Snapshot history' })).toBeVisible()
  await expect(page.getByText(/Cash, deposits, and withdrawals are placeholders/)).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('link', { name: /open monthly accounting report/i })).toHaveAttribute('href', '/accounting/monthly')
})
