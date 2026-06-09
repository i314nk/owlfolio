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
    exclude: [...configDefaults.exclude, 'apps/web/e2e/**', '**/e2e/**', '.worktrees/**'],
    globals: true,
    passWithNoTests: true,
  },
})
