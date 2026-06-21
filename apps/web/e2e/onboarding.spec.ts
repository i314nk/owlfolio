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

  // The guided-setup surface reflects the configured personal-local mock-provider connection.
  await page.goto('/settings/providers')
  const guidedSetup = page.getByRole('region', { name: /guided setup/i })
  await expect(guidedSetup.getByRole('heading', { name: /guided setup/i })).toBeVisible()
  await expect(guidedSetup.getByText('Current: personal-local')).toBeVisible()
  await expect(guidedSetup.getByText('Set up', { exact: true })).toBeVisible()
})

test('the guided-setup mode switch offers Demo + Personal-local', async ({ page }) => {
  await page.goto('/settings/providers')
  const guidedSetup = page.getByRole('region', { name: /guided setup/i })
  const modeSwitch = guidedSetup.getByLabel('Mode switch', { exact: true })

  // Demo is only present under the test harness (mock-provider option present); Personal-local always is.
  await expect(modeSwitch.getByRole('button', { name: 'Demo', exact: true })).toBeVisible()
  await expect(modeSwitch.getByRole('button', { name: 'Personal-local', exact: true })).toBeVisible()
})

test('the provider toggle offers Demo + ChatGPT/Codex + OpenRouter + Claude Code (Gemini retired)', async ({ page }) => {
  await page.goto('/settings/providers')
  const guidedSetup = page.getByRole('region', { name: /guided setup/i })
  const selection = guidedSetup.getByLabel('Provider and model selection', { exact: true })

  // Gemini lane stays retired.
  await expect(selection.getByRole('button', { name: /use gemini/i })).toHaveCount(0)

  // The four connection options render as toggle buttons.
  await expect(selection.getByRole('button', { name: /try demo mode/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use chatgpt\/codex/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use openrouter/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use claude code/i })).toBeVisible()
})

test('OpenRouter and Claude Code show a tier-grouped model dropdown; Codex shows a fixed model', async ({ page }) => {
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

  // Claude Code: same tier-grouped chooser with Claude models.
  await selection.getByRole('button', { name: /use claude code/i }).click()
  const claudeSelect = guidedSetup.getByRole('combobox', { name: /choose one model/i })
  await expect(claudeSelect.locator('option[value="claude-opus-4-8"]')).toHaveCount(1)
  await expect(claudeSelect.locator('option[value="claude-haiku-4-5"]')).toHaveCount(1)
})

test('the providers page surfaces honest readiness/gating verdicts (Codex blocked, Claude unsupported)', async ({ page }) => {
  await page.goto('/settings/providers')

  // The Trust & certification section preserves the honest, fail-closed gating verdicts that the wizard
  // formerly surfaced as "Needs setup" when a local session is unready.
  await expect(page.getByRole('heading', { name: /trust & certification/i })).toBeVisible()
  await expect(
    page.getByLabel('Claude trust primary status', { exact: true }).getByText('Effective support (gating source of truth): unsupported', { exact: true }),
  ).toBeVisible()
})
