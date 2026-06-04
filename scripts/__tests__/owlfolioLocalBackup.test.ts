import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildRestoreDryRunPlan,
  buildRuntimeBackupManifest,
  resolveRuntimeBackupInventory,
  type RuntimeBackupManifest,
} from '../owlfolio-local-backup'

const appConfig = (overrides: Partial<RuntimeBackupManifest['app_config']> = {}): RuntimeBackupManifest['app_config'] => ({
  version: 1,
  mode: 'personal-local',
  provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
  strategy_id: 'buffett-munger',
  shariah: {
    enabled: true,
    policy_basis: 'AAOIFI',
    allow_conditional: true,
    non_compliant_income_threshold: 0.05,
  },
  market_universe: { scope_id: 'public-equities', label: 'Public equities', broker_required: false },
  ...overrides,
})

async function makeProject(prefix: string) {
  const projectDir = mkdtempSync(join(tmpdir(), prefix))
  await writeFile(join(projectDir, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8')
  await mkdir(join(projectDir, 'data'), { recursive: true })
  return projectDir
}

describe('Owlfolio local backup runtime inventory', () => {
  it('uses environment override precedence before app-config/default runtime paths', async () => {
    const projectDir = await makeProject('owlfolio-backup-env-')
    const configPath = join(projectDir, 'operator-config.json')
    await writeFile(configPath, JSON.stringify(appConfig({
      ledger_path: join(projectDir, 'config-ledgers', 'personal.sqlite'),
      source_ledger_path: join(projectDir, 'config-source-ledger'),
    })), 'utf8')

    const inventory = await resolveRuntimeBackupInventory({
      cwd: projectDir,
      env: {
        OWLFOLIO_PROJECT_DIR: projectDir,
        OWLFOLIO_APP_CONFIG_PATH: configPath,
        OWLFOLIO_DEMO_LEDGER_PATH: join(projectDir, 'env-ledgers', 'demo.sqlite'),
        OWLFOLIO_PERSONAL_LEDGER_PATH: join(projectDir, 'env-ledgers', 'personal.sqlite'),
        OWLFOLIO_LEDGER_PATH: join(projectDir, 'env-ledgers', 'worker.sqlite'),
        OWLFOLIO_SOURCE_LEDGER_PATH: join(projectDir, 'env-source-ledger'),
        OWLFOLIO_PROVIDER_CERTIFICATION_DIR: join(projectDir, 'env-provider-certifications'),
      },
    })

    expect(inventory.project_dir).toBe(projectDir)
    expect(inventory.included_entries.map((entry) => [entry.role, entry.absolute_path])).toEqual([
      ['app_config', configPath],
      ['demo_ledger', join(projectDir, 'env-ledgers', 'demo.sqlite')],
      ['personal_ledger', join(projectDir, 'env-ledgers', 'personal.sqlite')],
      ['worker_ledger', join(projectDir, 'env-ledgers', 'worker.sqlite')],
      ['source_ledger', join(projectDir, 'env-source-ledger')],
      ['provider_certifications', join(projectDir, 'env-provider-certifications')],
    ])
  })

  it('uses app-config ledger and source-ledger paths when env overrides are absent', async () => {
    const projectDir = await makeProject('owlfolio-backup-config-')
    const configPath = join(projectDir, 'data', 'app-config.json')
    const ledgerPath = join(projectDir, 'personal-runtime', 'ledger.sqlite')
    const sourceLedgerPath = join(projectDir, 'personal-runtime', 'source-ledger')
    await writeFile(configPath, JSON.stringify(appConfig({
      ledger_path: ledgerPath,
      source_ledger_path: sourceLedgerPath,
    })), 'utf8')

    const inventory = await resolveRuntimeBackupInventory({
      cwd: projectDir,
      env: { OWLFOLIO_PROJECT_DIR: projectDir },
    })

    expect(inventory.included_entries.find((entry) => entry.role === 'personal_ledger')?.absolute_path).toBe(ledgerPath)
    expect(inventory.included_entries.find((entry) => entry.role === 'source_ledger')?.absolute_path).toBe(sourceLedgerPath)
    expect(inventory.included_entries.find((entry) => entry.role === 'provider_certifications')?.absolute_path).toBe(
      join(projectDir, 'data', 'provider-certifications'),
    )
  })

  it('builds a checksum manifest for allowlisted runtime files and SQLite sidecars', async () => {
    const projectDir = await makeProject('owlfolio-backup-manifest-')
    await writeFile(join(projectDir, 'data', 'app-config.json'), JSON.stringify(appConfig()), 'utf8')
    await writeFile(join(projectDir, 'data', 'personal-ledger.sqlite'), 'ledger-bytes', 'utf8')
    await writeFile(join(projectDir, 'data', 'personal-ledger.sqlite-wal'), 'wal-bytes', 'utf8')
    await mkdir(join(projectDir, 'data', 'source-ledger'), { recursive: true })
    await writeFile(join(projectDir, 'data', 'source-ledger', 'research-source-bundle-rc_1.json'), '{"ok":true}', 'utf8')

    const manifest = await buildRuntimeBackupManifest({
      cwd: projectDir,
      env: { OWLFOLIO_PROJECT_DIR: projectDir },
      now: () => '2026-06-03T12:00:00.000Z',
      gitCommit: async () => 'testcommit',
    })

    expect(manifest.schema_version).toBe(1)
    expect(manifest.created_at_utc).toBe('2026-06-03T12:00:00.000Z')
    expect(manifest.git_commit).toBe('testcommit')
    expect(manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'app_config', relative_path: 'data/app-config.json', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ role: 'personal_ledger', relative_path: 'data/personal-ledger.sqlite', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ role: 'sqlite_sidecar', relative_path: 'data/personal-ledger.sqlite-wal', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ role: 'source_ledger', relative_path: 'data/source-ledger/research-source-bundle-rc_1.json', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]))
  })

  it('does not include credentials, auth homes, env files, pids, logs, or generated runtime dirs', async () => {
    const projectDir = await makeProject('owlfolio-backup-secret-')
    await writeFile(join(projectDir, 'data', 'app-config.json'), JSON.stringify(appConfig()), 'utf8')
    await writeFile(join(projectDir, '.env'), 'OPENAI_API_KEY=secret', 'utf8')
    await mkdir(join(projectDir, 'secrets'), { recursive: true })
    await writeFile(join(projectDir, 'secrets', 'provider-token.txt'), 'secret', 'utf8')
    await writeFile(join(projectDir, 'data', 'worker.pid'), '1234', 'utf8')
    await mkdir(join(projectDir, 'logs'), { recursive: true })
    await writeFile(join(projectDir, 'logs', 'app.log'), 'log', 'utf8')
    await mkdir(join(projectDir, '.playwright-runtime'), { recursive: true })
    await writeFile(join(projectDir, '.playwright-runtime', 'personal-ledger.sqlite'), 'test-ledger', 'utf8')

    const manifest = await buildRuntimeBackupManifest({
      cwd: projectDir,
      env: {
        OWLFOLIO_PROJECT_DIR: projectDir,
        OWLFOLIO_CODEX_AUTH_PATH: join(projectDir, 'secrets', 'provider-token.txt'),
        CODEX_HOME: join(projectDir, 'secrets', 'codex-home'),
        GEMINI_HOME: join(projectDir, 'secrets', 'gemini-home'),
      },
      now: () => '2026-06-03T12:00:00.000Z',
      gitCommit: async () => 'testcommit',
    })

    const paths = manifest.files.map((file) => file.relative_path)
    expect(paths).not.toContain('.env')
    expect(paths).not.toContain('secrets/provider-token.txt')
    expect(paths).not.toContain('data/worker.pid')
    expect(paths).not.toContain('logs/app.log')
    expect(paths).not.toContain('.playwright-runtime/personal-ledger.sqlite')
    expect(manifest.excluded_paths).toEqual(expect.arrayContaining([
      expect.objectContaining({ pattern: '.env*', reason: expect.stringContaining('secret') }),
      expect.objectContaining({ pattern: 'OWLFOLIO_*_AUTH_PATH targets', reason: expect.stringContaining('provider') }),
      expect.objectContaining({ pattern: '.playwright-runtime/', reason: expect.stringContaining('generated') }),
    ]))
  })

  it('builds a restore dry-run plan that rewrites app-config paths into an isolated runtime root', async () => {
    const restoreRoot = join(tmpdir(), 'owlfolio-restore-target')
    const manifest = {
      schema_version: 1 as const,
      created_at_utc: '2026-06-03T12:00:00.000Z',
      project_dir: '/old/owlfolio',
      git_commit: 'testcommit',
      files: [
        { role: 'app_config' as const, relative_path: 'data/app-config.json', size_bytes: 100, sha256: 'a'.repeat(64) },
        { role: 'personal_ledger' as const, relative_path: 'data/personal-ledger.sqlite', size_bytes: 200, sha256: 'b'.repeat(64) },
        { role: 'source_ledger' as const, relative_path: 'data/source-ledger/source.json', size_bytes: 50, sha256: 'c'.repeat(64) },
        { role: 'provider_certifications' as const, relative_path: 'data/provider-certifications/mock-provider.latest.json', size_bytes: 75, sha256: 'd'.repeat(64) },
      ],
      included_entries: [],
      excluded_paths: [],
      app_config: appConfig({
        ledger_path: '/old/owlfolio/data/personal-ledger.sqlite',
        source_ledger_path: '/old/owlfolio/data/source-ledger',
      }),
    }

    const plan = buildRestoreDryRunPlan({ manifest, restoreRoot })

    expect(plan.mode).toBe('personal-local')
    expect(plan.provider).toEqual({ provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' })
    expect(plan.counts).toEqual({ files: 4, ledgers: 1, source_bundles: 1, provider_reports: 1 })
    expect(plan.path_rewrites).toEqual([
      {
        field: 'ledger_path',
        from: '/old/owlfolio/data/personal-ledger.sqlite',
        to: join(restoreRoot, 'runtime', 'data', 'personal-ledger.sqlite'),
      },
      {
        field: 'source_ledger_path',
        from: '/old/owlfolio/data/source-ledger',
        to: join(restoreRoot, 'runtime', 'data', 'source-ledger'),
      },
    ])
    expect(plan.verification_env).toMatchObject({
      OWLFOLIO_APP_CONFIG_PATH: join(restoreRoot, 'runtime', 'data', 'app-config.json'),
      OWLFOLIO_LEDGER_PATH: join(restoreRoot, 'runtime', 'data', 'personal-ledger.sqlite'),
      OWLFOLIO_SOURCE_LEDGER_PATH: join(restoreRoot, 'runtime', 'data', 'source-ledger'),
      OWLFOLIO_PROVIDER_CERTIFICATION_DIR: join(restoreRoot, 'runtime', 'data', 'provider-certifications'),
    })
  })
})
