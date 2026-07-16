import { expect, test } from '@playwright/test'

import { initWorkflow } from './helpers'

// The 13F discovery page smoke (owner-approved 2026-07-16): a fresh workspace renders the summary
// with its honesty rails and HONEST empty states — never fabricated portfolios or performance.

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('the 13F discovery page renders its sections with honest empty states', async ({ page, request }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text())
    }
  })

  await initWorkflow(request)
  await page.goto('/discovery')

  // Summary + honesty rails.
  const summary = page.getByRole('region', { name: /what the superinvestors page is/i })
  await expect(summary.getByText(/value superinvestors/i)).toBeVisible()
  await expect(summary.getByText(/45 days/)).toBeVisible()
  await expect(summary.getByText(/nothing here is a buy or sell instruction/i)).toBeVisible()

  // The action matrix, honestly empty on a fresh ledger.
  await expect(page.getByRole('region', { name: /manager actions/i }).getByText(/no manager actions harvested yet/i)).toBeVisible()
  const managers = page.getByRole('region', { name: /manager portfolios/i })
  await expect(managers.getByText(/no manager quarters harvested yet/i)).toBeVisible()
  // Dormant filers are labeled, never faked as live books.
  await expect(managers.getByText(/below the 13F reporting threshold/i)).toBeVisible()

  expect(browserErrors).toEqual([])
})
