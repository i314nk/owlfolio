import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('research nav in default mode opens the strategy pipeline cockpit with manual intake secondary', async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('navigation', { name: /primary owlfolio navigation/i })
    .getByRole('link', { name: /research/i })
    .click()

  await expect(page).toHaveURL('/research')
  await expect(page.getByRole('heading', { name: /strategy pipeline cockpit/i })).toBeVisible()
  await expect(page.getByText(/selected strategy: buffett-munger/i)).toBeVisible()
  for (const sectionName of [
    'Discovered',
    'Quick Screen',
    'Deep Dive Queue',
    'In Deep Dive',
    'Synthesis / Decision Pending',
    'Watchlist',
    'Rejected / Passed',
  ]) {
    await expect(page.getByRole('heading', { name: sectionName })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: /manual ticker intake/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /open learn guide/i })).toBeVisible()
  await expect(page.getByText(/Buffett-Munger certified/i)).toHaveCount(0)
})

test('default home page renders the demo command center and research demo workflow link', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
  await expect(page.getByText(/provider: mock provider \/ demo mode/i)).toBeVisible()
  await expect(page.getByText(/strategy: buffett-munger default/i)).toBeVisible()
  await expect(page.getByText(/view demo research case/i)).toBeVisible()

  await page.getByRole('link', { name: /view demo research case/i }).click()

  await expect(page.getByRole('heading', { name: 'COST', exact: true })).toBeVisible()
  await expect(page.getByText(/investment verdict.*watch/i)).toBeVisible()
  await expect(page.getByText(/strategy compliance.*conditional/i)).toBeVisible()
  await expect(page.getByText('Shariah status: COMPLIANT', { exact: true })).toBeVisible()
  await expect(page.getByText(/valuation status/i)).toBeVisible()
})
