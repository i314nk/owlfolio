import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'apps/web/e2e/**', '**/e2e/**', '.worktrees/**'],
    globals: true,
    passWithNoTests: true,
  },
})
