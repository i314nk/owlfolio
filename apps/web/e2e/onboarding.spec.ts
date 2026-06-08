import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('demo onboarding initializes the durable demo workflow', async ({ page }) => {
  await page.goto('/onboarding')

  await expect(page.getByRole('heading', { name: /start setup/i })).toBeVisible()
  await expect(page.getByText(/1\. choose how to explore/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /use chatgpt\/codex/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /use gemini/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /try demo mode/i })).toBeVisible()

  await page.getByRole('button', { name: /use chatgpt\/codex/i }).click()
  await expect(page.getByText('Needs setup', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: /try demo mode/i }).click()
  await expect(page.getByText(/ready to start/i).first()).toBeVisible()

  await page.getByRole('button', { name: /start using owlfolio/i }).click()

  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
  await expect(page.getByText(/setup ready/i)).toBeVisible()
  await expect(page.getByText(/provider: mock provider \/ demo mode/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /view demo research case/i })).toBeVisible()
})

test('Codex onboarding shows a concise blocked state when the local session is unready', async ({ page }) => {
  await page.goto('/onboarding')

  await page.getByRole('button', { name: /use chatgpt\/codex/i }).click()

  await expect(page.getByRole('heading', { name: /start setup/i })).toBeVisible()
  await expect(page.getByText('Needs setup', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/owlfolio cannot find your chatgpt\/codex login yet/i).first()).toBeVisible()
  await expect(page.getByText(/sign in to chatgpt\/codex on this computer/i).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /learn setup guide/i })).toHaveAttribute('href', '/learn#providers')
  await expect(page.getByRole('button', { name: /^finish setup first$/i })).toBeDisabled()
  await expect(page.getByRole('heading', { name: /command center/i })).not.toBeVisible()
})

test('Gemini CLI onboarding is visibly setup-only and cannot start workflow execution', async ({ page }) => {
  await page.goto('/onboarding')

  await page.getByRole('button', { name: /use gemini/i }).click()

  await expect(page.getByText('Local AI preview', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/owlfolio cannot find your gemini sign-in yet|gemini sign-in can be detected/i).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^finish setup first$/i })).toBeDisabled()
  await expect(page.getByText(/gemini developer api, vertex, or production automation/i)).toHaveCount(0)
})
