import { fileURLToPath } from 'node:url'

import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // next/font/google relies on Next's build-time SWC transform; alias it to
      // a stub so font-wiring modules (e.g. AppShell) load under vitest.
      'next/font/google': fileURLToPath(
        new URL('./apps/web/test/nextFontGoogleStub.ts', import.meta.url),
      ),
    },
  },
  test: {
    // Exclude e2e (Playwright) and any nested git worktrees. Worktrees live under BOTH `.worktrees/`
    // (manual) and `.claude/worktrees/` (harness-created); each is a full checkout whose src test copies
    // would otherwise be scanned and double-run the suite. Match at any depth so a clean run stays clean.
    exclude: [...configDefaults.exclude, 'apps/web/e2e/**', '**/e2e/**', '**/.worktrees/**', '**/.claude/**'],
    globals: true,
    passWithNoTests: true,
  },
})
