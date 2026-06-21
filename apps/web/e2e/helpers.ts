import { expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

type InitWorkflowOptions = {
  mode?: 'demo' | 'personal-local'
  providerId?: string
  modelId?: string
}

/**
 * Programmatic onboarding init for e2e specs — replaces driving the wizard UI to perform setup.
 *
 * POSTs to the test-mode-only `/api/testing/init` route (mirrors how the specs already POST to
 * `/api/testing/reset`). Defaults to the harness path the specs depend on: mock-provider in
 * personal-local mode, which the init route allows directly (bypassing the production demo-rewrite).
 * Use Playwright's `request` fixture — this performs init with NO UI, so the wizard can be removed later.
 */
export async function initWorkflow(
  request: APIRequestContext,
  { mode = 'personal-local', providerId = 'mock-provider', modelId = 'mock-buffett-munger-demo' }: InitWorkflowOptions = {},
): Promise<void> {
  const response = await request.post('/api/testing/init', {
    data: {
      mode,
      provider: { provider_id: providerId, support_level: 'certified', model_id: modelId },
    },
  })
  expect(response.ok()).toBe(true)
}
