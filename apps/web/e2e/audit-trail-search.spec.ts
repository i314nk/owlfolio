import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function initializeDemoWorkflow(page: Page): Promise<void> {
  await page.goto('/onboarding')
  await page.getByRole('radio', { name: /personal local mode/i }).click()
  await page.getByRole('combobox').selectOption('mock-provider')
  await page.getByRole('button', { name: /initialize owlfolio workflow/i }).click()
  await expect(page).toHaveURL('/')
}

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('audit trail command affordance link focuses query search input', async ({ page }) => {
  await initializeDemoWorkflow(page)

  await page
    .getByRole('navigation', { name: /primary owlfolio navigation/i })
    .getByRole('link', { name: /audit trail search/i })
    .click()

  await expect(page).toHaveURL('/audit?focus=1')
  const searchInput = page.getByRole('searchbox', { name: /search raw ledger evidence/i })
  await expect(searchInput).toBeFocused()
})
