import { expect, test } from '@playwright/test'

import { initWorkflow } from './helpers'

/**
 * Guided-setup surface tests. These previously drove the onboarding WIZARD (/onboarding). They now assert
 * the `/settings/providers` GuidedSetupPanel surface — the shared toggle + tier-grouped model dropdown +
 * readiness that the wizard delegated to — so the wizard can be deleted in a follow-up slice. The actual
 * onboarding INIT for downstream flows is now programmatic via `initWorkflow` (POST /api/testing/init),
 * not a UI dance.
 *
 * Behavioral intent preserved: a user can pick a connection + a model and see honest readiness/gating.
 */

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('programmatic init lands a set-up command center (replaces the wizard start flow)', async ({ page, request }) => {
  await initWorkflow(request)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()

  // The guided-setup surface reflects the configured personal-local mock-provider connection. The
  // redundant mode toggle + "Current/Set up" status were removed (one local mode; selecting a provider
  // sets up personal-local) — the surface is now just the provider/model picker.
  await page.goto('/settings/providers')
  const guidedSetup = page.getByRole('region', { name: /guided setup/i })
  await expect(guidedSetup.getByRole('heading', { name: /choose a provider and model/i })).toBeVisible()
})

test('the provider toggle offers Demo + ChatGPT/Codex + OpenRouter + the direct-API providers', async ({ page }) => {
  await page.goto('/settings/providers')
  const guidedSetup = page.getByRole('region', { name: /guided setup/i })
  const selection = guidedSetup.getByLabel('Provider and model selection', { exact: true })

  // The connection options render as toggle buttons: demo + the local Codex/OpenRouter lanes + the three
  // direct-API providers (Anthropic / OpenAI / Gemini), each keyed by its own API key.
  await expect(selection.getByRole('button', { name: /try demo mode/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use chatgpt\/codex/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use openrouter/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use anthropic \(claude\)/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use openai \(api key\)/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use gemini \(google\)/i })).toBeVisible()
  // The retired Claude *CLI* login lane is not a connection card.
  await expect(selection.getByRole('button', { name: /use claude code/i })).toHaveCount(0)
})

test('OpenRouter and Anthropic show a tier-grouped model dropdown; Codex shows a fixed model', async ({ page }) => {
  await page.goto('/settings/providers')
  const guidedSetup = page.getByRole('region', { name: /guided setup/i })
  const selection = guidedSetup.getByLabel('Provider and model selection', { exact: true })

  // Codex: fixed model, no chooser.
  await selection.getByRole('button', { name: /use chatgpt\/codex/i }).click()
  await expect(guidedSetup.getByLabel('Fixed model')).toContainText('gpt-5.5')
  await expect(guidedSetup.getByRole('combobox', { name: /choose one model/i })).toHaveCount(0)

  // OpenRouter: tier-grouped dropdown with all curated options.
  await selection.getByRole('button', { name: /use openrouter/i }).click()
  const openRouterSelect = guidedSetup.getByRole('combobox', { name: /choose one model/i })
  await expect(openRouterSelect).toBeVisible()
  await expect(openRouterSelect.locator('optgroup[label="Tier 1"]')).toHaveCount(1)
  await expect(openRouterSelect.locator('optgroup[label="Tier 2"]')).toHaveCount(1)
  await expect(openRouterSelect.locator('optgroup[label="Tier 3"]')).toHaveCount(1)
  await expect(openRouterSelect.locator('option[value="anthropic/claude-opus-4.8"]')).toHaveCount(1)

  // Anthropic (direct API key): same tier-grouped chooser with Claude models. (The retired Claude *CLI*
  // login is gone; Anthropic is now a real, selectable direct-API provider keyed by ANTHROPIC_API_KEY.)
  await selection.getByRole('button', { name: /use anthropic \(claude\)/i }).click()
  const claudeSelect = guidedSetup.getByRole('combobox', { name: /choose one model/i })
  await expect(claudeSelect.locator('option[value="claude-opus-4-8"]')).toHaveCount(1)
  await expect(claudeSelect.locator('option[value="claude-haiku-4-5"]')).toHaveCount(1)
})

test('the providers page places model-quality responsibility on the user (no trust gate)', async ({ page }) => {
  await page.goto('/settings/providers')

  // The heavy "Trust gate" / certification section was removed — research quality depends on the model
  // the user chooses, and that responsibility is theirs. The honest framing stays on the selection surface.
  await expect(page.getByRole('heading', { name: /trust & certification/i })).toHaveCount(0)
  await expect(page.getByText(/Research quality depends on the model you choose/i)).toBeVisible()
})
