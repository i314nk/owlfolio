import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('research nav in default mode opens the research library with manual intake', async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('navigation', { name: /primary owlfolio navigation/i })
    .getByRole('link', { name: /research/i })
    .click()

  await expect(page).toHaveURL('/research')
  await expect(page.getByRole('heading', { name: /research library/i })).toBeVisible()
  // The live stage/execution view now lives on the Pipeline page, not here.
  await expect(page.getByRole('link', { name: /watch live execution on the pipeline/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /manual ticker intake/i })).toBeVisible()
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
  await expect(page.getByText('Research dossier')).toBeVisible()
  await expect(page.getByText('Verdict summary')).toBeVisible()
  await expect(page.getByText('WATCH', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Thesis' })).toBeVisible()
  // The per-dimension valuation/shariah/risks cards were consolidated away; valuation + Shariah status
  // surface on the verdict-hero chips and the findings live in the (collapsed) specialist lanes.
  await expect(page.getByText('FAIR').first()).toBeVisible()
  await expect(page.getByText('COMPLIANT').first()).toBeVisible()
  await page.getByText('Evidence and audit details', { exact: true }).click()
  await expect(page.getByText('Gate checklist')).toBeVisible()
})
