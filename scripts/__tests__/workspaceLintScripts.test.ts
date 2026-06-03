import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')

const workspacePackageJsonPaths = [
  'apps/web/package.json',
  'apps/worker/package.json',
  'packages/ledger/package.json',
  'packages/providers/package.json',
  'packages/shared/package.json',
  'packages/shariah/package.json',
  'packages/strategies/package.json',
  'packages/workflow/package.json',
]

function readPackageJson(relativePath: string) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as {
    name: string
    scripts?: Record<string, string>
  }
}

describe('workspace lint scripts', () => {
  it('run real eslint checks instead of placeholder scripts in every workspace package', () => {
    for (const packageJsonPath of workspacePackageJsonPaths) {
      const packageJson = readPackageJson(packageJsonPath)
      const lintScript = packageJson.scripts?.lint ?? ''

      expect(lintScript, `${packageJson.name} lint script`).toContain('eslint')
      expect(lintScript, `${packageJson.name} lint script`).not.toContain('Lint not configured')
      expect(lintScript, `${packageJson.name} lint script`).not.toContain('console.log')
    }
  })

  it('keeps Playwright e2e specs out of unit-test discovery', () => {
    const vitestConfig = readFileSync(join(root, 'vitest.config.ts'), 'utf8')

    expect(vitestConfig).toContain('apps/web/e2e/**')
    expect(vitestConfig).toContain('**/e2e/**')
  })
})
