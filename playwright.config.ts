import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './apps/web/e2e',
  workers: 1,
  // The long personal-workflow-intake spec has a known flaky tail (the override sign-off POST→redirect
  // and the subsequent /audit navigation race under the single-worker dev server — stable in isolation,
  // non-deterministic under the full end-to-end run). Retry to absorb that flake; `trace: 'on-first-retry'`
  // already anticipates retries. Deterministic failures still fail every attempt.
  retries: 2,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'OWLFOLIO_TEST_MODE=playwright OWLFOLIO_PROJECT_DIR=$PWD OWLFOLIO_APP_CONFIG_PATH=$PWD/.playwright-runtime/app-config.json OWLFOLIO_PERSONAL_LEDGER_PATH=$PWD/.playwright-runtime/personal-ledger.sqlite OWLFOLIO_CLAUDE_CREDENTIALS_PATH=$PWD/.playwright-runtime/missing-claude.json OWLFOLIO_CODEX_AUTH_PATH=$PWD/.playwright-runtime/missing-codex-auth.json ANTHROPIC_API_KEY= OPENAI_API_KEY= corepack pnpm dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
