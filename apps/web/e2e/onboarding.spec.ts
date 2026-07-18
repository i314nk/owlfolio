import { expect, test } from '@playwright/test'

import { initWorkflow } from './helpers'

/**
 * Guided-setup surface tests. These previously drove the onboarding WIZARD (/onboarding). They now assert
 * the `/settings/providers` GuidedSetupPanel surface — the shared toggle + model picker +
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

test('the provider toggle offers the real providers, and never the internal mock provider', async ({ page }) => {
  await page.goto('/settings/providers')
  const guidedSetup = page.getByRole('region', { name: /guided setup/i })
  const selection = guidedSetup.getByLabel('Provider and model selection', { exact: true })

  // PROVIDER CONSOLIDATION (owner, 2026-07-18): the connection options are OpenRouter + the
  // experimental LOCAL surface (Ollama / vLLM) ONLY. The internal mock provider (and the retired
  // "Try demo mode" card) are NOT offered, and the direct API-key providers are gone.
  await expect(selection.getByRole('button', { name: /try demo mode/i })).toHaveCount(0)
  await expect(selection.getByRole('button', { name: /use openrouter/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use a local model \(ollama \/ vllm\)/i })).toBeVisible()
  await expect(selection.getByRole('button', { name: /use anthropic/i })).toHaveCount(0)
  await expect(selection.getByRole('button', { name: /use openai/i })).toHaveCount(0)
  await expect(selection.getByRole('button', { name: /use gemini/i })).toHaveCount(0)
  // The retired Claude *CLI* login lane is not a connection card.
  await expect(selection.getByRole('button', { name: /use claude code/i })).toHaveCount(0)
  // The local card must SAY it is unstable/experimental/untested — never quietly normal.
  await expect(selection.getByText(/UNSTABLE \/ EXPERIMENTAL \/ UNTESTED/i).first()).toBeVisible()
})

test('OpenRouter shows a flat curated model picker; the local card shows the free-form input', async ({ page }) => {
  await page.goto('/settings/providers')
  const guidedSetup = page.getByRole('region', { name: /guided setup/i })
  const selection = guidedSetup.getByLabel('Provider and model selection', { exact: true })

  // OpenRouter with no live catalog (no key in the test env): the flat curated dropdown — no tier
  // optgroups (model tiering removed, owner 2026-07-18). With a live catalog it becomes the
  // searchable picker; both paths land on one concrete model id.
  await selection.getByRole('button', { name: /use openrouter/i }).click()
  const modelControl = guidedSetup.getByRole('combobox', { name: /choose one model/i }).or(
    guidedSetup.getByRole('textbox', { name: /search or enter an openrouter model id/i }),
  )
  await expect(modelControl.first()).toBeVisible()
  await expect(guidedSetup.locator('optgroup')).toHaveCount(0)

  // The local surface has no curated list: a free-form model input + explicit Set button.
  await selection.getByRole('button', { name: /use a local model \(ollama \/ vllm\)/i }).click()
  await expect(guidedSetup.getByRole('textbox', { name: /enter the local model id/i })).toBeVisible()
  await expect(guidedSetup.getByRole('button', { name: /set the local model/i })).toBeVisible()
})

test('the providers page places model-quality responsibility on the user (no trust gate)', async ({ page }) => {
  await page.goto('/settings/providers')

  // The heavy "Trust gate" / certification section was removed — research quality depends on the model
  // the user chooses, and that responsibility is theirs. The honest framing stays on the selection surface.
  await expect(page.getByRole('heading', { name: /trust & certification/i })).toHaveCount(0)
  await expect(page.getByText(/Research quality depends on the model you choose/i)).toBeVisible()
})
