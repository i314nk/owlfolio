import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

import {
  loadAppConfig,
  resolveAppConfigPath,
  resolveProjectRootFromCwd,
  resolveSourceLedgerPath,
  saveAppConfig,
} from '../appConfigStore'

describe('appConfigStore', () => {
  async function withTempProject(assertion: (projectDir: string) => Promise<void>) {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-config-store-'))
    try {
      await assertion(projectDir)
    } finally {
      await rm(projectDir, { force: true, recursive: true })
    }
  }

  it('returns an explicit unconfigured default for a fresh install (no config file)', async () => {
    await withTempProject(async (projectDir) => {
      // A brand-new install is always unconfigured — nothing silently falls through to a working mode.
      const config = await loadAppConfig({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })

      expect(config.mode).toBe('unconfigured')
      expect(config.ledger_path).toBeUndefined()
      expect(config.initialized_at).toBeUndefined()
      expect(config.strategy_id).toBe('buffett-munger')
      expect(config.shariah.enabled).toBe(true)
    })
  })

  it('saves and reloads a personal local config from the default workspace data path', async () => {
    await withTempProject(async (projectDir) => {
      const config = {
        ...defaultPersonalLocalAppConfig(),
        ledger_path: join(projectDir, 'data', 'personal-ledger.sqlite'),
        source_ledger_path: join(projectDir, 'data', 'source-ledger'),
        initialized_at: '2026-05-28T12:00:00.000Z',
      }

      await saveAppConfig(config, { env: { OWLFOLIO_PROJECT_DIR: projectDir } })
      const reloaded = await loadAppConfig({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })

      expect(resolveAppConfigPath({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })).toBe(join(projectDir, 'data', 'app-config.json'))
      expect(resolveSourceLedgerPath({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })).toBe(join(projectDir, 'data', 'source-ledger'))
      expect(reloaded).toEqual(config)
    })
  })

  it('resolves an explicit config path override', async () => {
    await withTempProject(async (projectDir) => {
      const explicitPath = join(projectDir, 'custom', 'owlfolio.json')
      await mkdir(join(projectDir, 'custom'), { recursive: true })
      await writeFile(explicitPath, JSON.stringify(defaultPersonalLocalAppConfig(), null, 2), 'utf8')

      const loaded = await loadAppConfig({ env: { OWLFOLIO_APP_CONFIG_PATH: explicitPath, OWLFOLIO_PROJECT_DIR: projectDir } })

      expect(resolveAppConfigPath({ env: { OWLFOLIO_APP_CONFIG_PATH: explicitPath, OWLFOLIO_PROJECT_DIR: projectDir } })).toBe(explicitPath)
      expect(loaded.mode).toBe('personal-local')
    })
  })

  it('walks upward from nested app directories to the workspace root', async () => {
    await withTempProject(async (projectDir) => {
      const nestedDir = join(projectDir, 'apps', 'web', 'src')
      await mkdir(nestedDir, { recursive: true })
      await writeFile(join(projectDir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n', 'utf8')

      expect(resolveProjectRootFromCwd(nestedDir)).toBe(projectDir)
      expect(resolveAppConfigPath({ cwd: nestedDir })).toBe(join(projectDir, 'data', 'app-config.json'))
      expect(resolveSourceLedgerPath({ cwd: nestedDir })).toBe(join(projectDir, 'data', 'source-ledger'))
    })
  })

  it('preserves filesystem root paths instead of collapsing to a relative data directory', () => {
    expect(resolveProjectRootFromCwd('/')).toBe('/')
    expect(resolveAppConfigPath({ cwd: '/' })).toBe('/data/app-config.json')
    expect(resolveSourceLedgerPath({ cwd: '/' })).toBe('/data/source-ledger')
  })
})
