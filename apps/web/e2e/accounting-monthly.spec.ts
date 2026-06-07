import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('monthly accounting report renders projected current period after a valuation snapshot', async ({ page }) => {
  await page.goto('/onboarding')
  await page.getByRole('button', { name: /connect codex/i }).click()
  await page.getByText('Other provider / advanced selector').click()
  await page.getByRole('combobox').selectOption('mock-provider')
  await page.getByRole('button', { name: /start owlfolio/i }).click()

  await page.getByRole('link', { name: /open research cockpit/i }).first().click()
  await expect(page).toHaveURL('/research')
  await page.getByRole('link', { name: /manual ticker intake/i }).click()
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
  await expect(page.getByRole('heading', { name: 'Scheduled valuation refresh' })).toBeVisible()
  await expect(page.getByText('Next scheduled check: 0 7 * * 1-5')).toBeVisible()
  await expect(page.getByText('Data source: mock-local-price-feed')).toBeVisible()
  await expect(page.getByText('Holdings missing data: MSFT')).toBeVisible()
  await page.getByText('Manual fallback actions', { exact: true }).click()
  await page.getByLabel('Current price per share').fill('900')
  await page.getByLabel('Valuation date').fill('2026-06-01')
  await page.getByRole('button', { name: /record valuation snapshot/i }).click()

  await page.goto('/accounting/monthly')
  await expect(page.getByRole('heading', { name: /monthly accounting report/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Current period summary' })).toBeVisible()
  await expect(page.getByText('Current NAV', { exact: true })).toBeVisible()
  await expect(page.getByText('Period NAV', { exact: true })).toBeVisible()
  await expect(page.getByText('$2,925.00').first()).toBeVisible()
  await expect(page.getByText('MSFT').first()).toBeVisible()
  await expect(page.getByText('Valuation freshness: 2026-06-01')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Snapshot history' })).toBeVisible()
  await expect(page.getByLabel('Accounting data provenance').getByText(/Cash, deposit, withdrawal, dividend, and fee totals appear only when matching ledger events exist for the period/)).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('link', { name: /open monthly accounting report/i })).toHaveAttribute('href', '/accounting/monthly')
})
