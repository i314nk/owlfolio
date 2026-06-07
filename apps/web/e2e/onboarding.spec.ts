import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('demo onboarding initializes the durable demo workflow', async ({ page }) => {
  await page.goto('/onboarding')

  await expect(page.getByRole('heading', { name: /connect owlfolio/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /connect codex/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /connect gemini/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /try demo locally/i })).toBeVisible()

  await page.getByRole('button', { name: /connect codex/i }).click()
  await expect(page.getByText('Start blocked', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: /try demo locally/i }).click()
  await expect(page.getByText(/ready to start/i).first()).toBeVisible()

  await page.getByRole('button', { name: /start owlfolio/i }).click()

  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
  await expect(page.getByText(/setup ready/i)).toBeVisible()
  await expect(page.getByText(/provider: mock provider \/ demo mode/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /view demo research case/i })).toBeVisible()
})

test('Codex onboarding shows a concise blocked state when the local session is unready', async ({ page }) => {
  await page.goto('/onboarding')

  await page.getByRole('button', { name: /connect codex/i }).click()

  await expect(page.getByRole('heading', { name: /connect owlfolio/i })).toBeVisible()
  await expect(page.getByText('Start blocked', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/missing openai \/ codex credentials|run codex login outside owlfolio/i).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /learn provider setup/i })).toHaveAttribute('href', '/learn#providers')
  await expect(page.getByRole('button', { name: /^start blocked$/i })).toBeDisabled()
  await expect(page.getByRole('heading', { name: /command center/i })).not.toBeVisible()
})

test('Gemini CLI onboarding is visibly setup-only and cannot start workflow execution', async ({ page }) => {
  await page.goto('/onboarding')

  await page.getByRole('button', { name: /connect gemini/i }).click()

  await expect(page.getByText('Setup only', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/missing gemini cli sign-in session|gemini cli is setup-only/i).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^start blocked$/i })).toBeDisabled()
  await expect(page.getByText(/gemini developer api, vertex, or production automation/i)).toHaveCount(0)
})
