import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './apps/web/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'OWLFOLIO_TEST_MODE=playwright OWLFOLIO_PROJECT_DIR=$PWD OWLFOLIO_APP_CONFIG_PATH=$PWD/.playwright-runtime/app-config.json OWLFOLIO_DEMO_LEDGER_PATH=$PWD/.playwright-runtime/demo-ledger.sqlite OWLFOLIO_PERSONAL_LEDGER_PATH=$PWD/.playwright-runtime/personal-ledger.sqlite OWLFOLIO_CLAUDE_CREDENTIALS_PATH=$PWD/.playwright-runtime/missing-claude.json ANTHROPIC_API_KEY= OPENAI_API_KEY= corepack pnpm dev',
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
