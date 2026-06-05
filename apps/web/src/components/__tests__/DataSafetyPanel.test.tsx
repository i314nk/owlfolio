import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DataSafetyPanel } from '../DataSafetyPanel'
import { buildDataSafetyViewModelFromManifest, type DataSafetyViewModel } from '../../lib/dataSafety'
import type { RuntimeBackupManifest } from '@owlfolio/shared/runtimeBackup'

function makeDataSafety(overrides: Partial<DataSafetyViewModel> = {}): DataSafetyViewModel {
  return {
    generated_at_utc: '2026-06-05T11:23:00.000Z',
    mode: 'personal-local',
    provider_id: 'mock-provider',
    project_dir_label: 'Owlfolio project workspace',
    manifest_available: true,
    manifest_file_count: 7,
    included_categories: [
      { label: 'App configuration', path_label: 'data/app-config.json', source: 'default', reason: 'allowlisted app configuration with provider IDs and local runtime path fields only' },
      { label: 'Personal ledger', path_label: 'data/personal-ledger.sqlite', source: 'app_config', reason: 'personal/local append-only investment workflow ledger' },
      { label: 'Source ledger', path_label: 'data/source-ledger', source: 'default', reason: 'private research source bundles referenced by ledger source_ids' },
      { label: 'Provider certification metadata', path_label: 'data/provider-certifications', source: 'default', reason: 'provider certification metadata and latest reports with credentials excluded' },
    ],
    excluded_categories: [
      { pattern: '.env*', reason: 'secret-bearing environment files are never copied into backup archives' },
      { pattern: 'Provider auth homes', reason: 'credential/session homes are excluded from investment-state backups' },
    ],
    restore: {
      status: 'proposal-only',
      restore_root_label: 'operator-selected restore root',
      counts: { files: 7, ledgers: 2, source_bundles: 1, provider_reports: 3 },
      path_rewrites: [
        { field: 'ledger_path', from_label: 'data/personal-ledger.sqlite', to_label: 'restore-root/runtime/data/personal-ledger.sqlite' },
        { field: 'source_ledger_path', from_label: 'data/source-ledger', to_label: 'restore-root/runtime/data/source-ledger' },
      ],
      verification_status: 'Dry-run verification proposal only; an operator must run the restore archive and verification commands from the runbook.',
    },
    ...overrides,
  }
}

describe('DataSafetyPanel', () => {
  it('renders privacy, manifest, category, and restore proposal copy for Settings Data Safety', () => {
    const html = renderToStaticMarkup(createElement(DataSafetyPanel, { dataSafety: makeDataSafety() }))

    expect(html).toContain('Settings / Data Safety')
    expect(html).toContain('personal-local')
    expect(html).toContain('mock-provider')
    expect(html).toContain('2026-06-05T11:23:00.000Z')
    expect(html).toContain('Backups contain investment ledgers, source bundles, provider certification metadata, and app configuration metadata')
    expect(html).toContain('They do not include credentials, API keys, provider auth homes, or CLI session files')
    expect(html).toContain('App configuration')
    expect(html).toContain('Personal ledger')
    expect(html).toContain('Provider certification metadata')
    expect(html).toContain('.env*')
    expect(html).toContain('Restore is dry-run/proposal only')
    expect(html).toContain('ledger_path')
    expect(html).toContain('restore-root/runtime/data/personal-ledger.sqlite')
    expect(html).toContain('operator must run the restore archive and verification commands')
  })

  it('does not expose secret, auth, or credential paths in rendered data safety output', () => {
    const html = renderToStaticMarkup(createElement(DataSafetyPanel, {
      dataSafety: makeDataSafety({
        included_categories: [
          { label: 'Personal ledger', path_label: 'data/personal-ledger.sqlite', source: 'env', reason: 'safe runtime ledger' },
        ],
        excluded_categories: [
          { pattern: 'Provider auth homes', reason: 'credential/session homes are excluded from investment-state backups' },
        ],
        restore: {
          status: 'proposal-only',
          restore_root_label: 'operator-selected restore root',
          counts: { files: 1, ledgers: 1, source_bundles: 0, provider_reports: 0 },
          path_rewrites: [
            { field: 'ledger_path', from_label: 'data/personal-ledger.sqlite', to_label: 'restore-root/runtime/data/personal-ledger.sqlite' },
          ],
          verification_status: 'Dry-run verification proposal only; an operator must run the restore archive and verification commands from the runbook.',
        },
      }),
    }))

    expect(html).not.toContain('/home/hermes_agent/.codex/auth.json')
    expect(html).not.toContain('/Users/alice/.gemini/oauth_creds.json')
    expect(html).not.toContain('CODEX_ACCESS_TOKEN')
    expect(html).not.toContain('ANTHROPIC_API_KEY')
    expect(html).not.toContain('secret-token')
  })
})

describe('buildDataSafetyViewModelFromManifest', () => {
  it('sanitizes secret-looking app-config paths before they reach the Settings view model', () => {
    const manifest: RuntimeBackupManifest = {
      schema_version: 1,
      created_at_utc: '2026-06-05T11:23:00.000Z',
      project_dir: '/srv/owlfolio',
      git_commit: 'abc123',
      files: [],
      included_entries: [
        {
          role: 'personal_ledger',
          absolute_path: '/home/alice/.codex/auth.json',
          relative_path: '../../home/alice/.codex/auth.json',
          source: 'app_config',
          include: true,
          reason: 'malformed app config path should not be displayed raw',
        },
      ],
      excluded_paths: [
        { pattern: '/home/alice/.gemini/oauth_creds.json', reason: 'provider auth homes are excluded' },
      ],
      app_config: {
        version: 1,
        mode: 'personal-local',
        provider: { provider_id: 'mock-provider', support_level: 'certified' },
        strategy_id: 'buffett-munger',
        shariah: {
          enabled: true,
          policy_basis: 'AAOIFI',
          allow_conditional: true,
          non_compliant_income_threshold: 0.05,
        },
        market_universe: {
          scope_id: 'public-equities',
          label: 'Public equities discovery universe',
          broker_required: false,
        },
        ledger_path: '/home/alice/.codex/auth.json',
      },
    }

    const viewModel = buildDataSafetyViewModelFromManifest({ manifest })
    const rendered = JSON.stringify(viewModel)

    expect(rendered).toContain('allowlisted personal ledger path')
    expect(rendered).toContain('configured ledger_path')
    expect(rendered).toContain('Provider auth homes and CLI credential files')
    expect(rendered).not.toContain('/home/alice/.codex/auth.json')
    expect(rendered).not.toContain('/home/alice/.gemini/oauth_creds.json')
    expect(rendered).not.toContain('oauth_creds')
  })
})
