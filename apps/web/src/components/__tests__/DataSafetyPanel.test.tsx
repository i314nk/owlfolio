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
    project_dir_label: 'Owner’s Manual project workspace',
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
    ...overrides,
  }
}

describe('DataSafetyPanel', () => {
  it('renders privacy, manifest, category, and restore proposal copy for Settings Data Safety', () => {
    const html = renderToStaticMarkup(createElement(DataSafetyPanel, { dataSafety: makeDataSafety() }))

    expect(html).toContain('Data Safety')
    expect(html).toContain('2026-06-05T11:23:00.000Z')
    // Mode and Provider are not shown in the backup manifest (they belong on Providers page)
    expect(html).not.toContain('>personal-local<')
    expect(html).not.toContain('>mock-provider<')
    expect(html).toContain('Backups contain investment ledgers, source bundles, provider certification metadata, and app configuration metadata')
    expect(html).toContain('They do not include credentials, API keys, provider auth homes, or CLI session files')
    expect(html).toContain('App configuration')
    expect(html).toContain('Personal ledger')
    expect(html).toContain('Provider certification metadata')
    expect(html).toContain('.env*')
    // TRIM (owner, 2026-07-18): the speculative restore dry-run plan is gone — restore is a plain
    // manual instruction (copy the files back; the app never restores automatically).
    expect(html).toContain('Restore is manual — copy the files back')
    expect(html).toContain('never restores automatically')
    // The REAL ops tooling is named (not a vague runbook): manifest + dry-run + verify commands.
    expect(html).toContain('ops:backup:manifest')
    expect(html).not.toContain('dry-run/proposal')
    expect(html).not.toContain('restore-root/')
    // The back link goes home — `/settings` is not a route (the old link was dead).
    expect(html).toContain('href="/"')
    expect(html).not.toContain('href="/settings"')
    // SCALE-DOWN: the sensitive-data note no longer lists the removed accounting/purification books.
    expect(html).not.toContain('accounting, and purification context')
  })

  it('i18n: the page chrome follows the locale; off-English shows the english-content note', () => {
    const html = renderToStaticMarkup(createElement(DataSafetyPanel, { dataSafety: makeDataSafety(), locale: 'ar' }))
    expect(html).toContain('أمان البيانات')
    expect(html).toContain('english-content-note')
    const en = renderToStaticMarkup(createElement(DataSafetyPanel, { dataSafety: makeDataSafety(), locale: 'en' }))
    expect(en).toContain('Data Safety')
    expect(en).not.toContain('english-content-note')
  })

  it('SAFETY: hides the destructive bulk-reset control unless explicitly gated on', () => {
    // The most important safety property: in normal operation (no bulkResetEnabled), the dev/test
    // wholesale-clear control must be ABSENT — not a disabled stub. (The enabled render mounts a
    // client control that needs the app-router context; its render is covered in BulkResetControl.test.tsx.)
    const withoutProp = renderToStaticMarkup(createElement(DataSafetyPanel, { dataSafety: makeDataSafety() }))
    expect(withoutProp).not.toContain('bulk-reset-control')
    expect(withoutProp).not.toContain('Developer / test tools')

    const disabled = renderToStaticMarkup(createElement(DataSafetyPanel, { dataSafety: makeDataSafety(), bulkResetEnabled: false }))
    expect(disabled).not.toContain('bulk-reset-control')
    expect(disabled).not.toContain('Developer / test tools')
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
    expect(rendered).toContain('Provider auth homes and CLI credential files')
    expect(rendered).not.toContain('/home/alice/.codex/auth.json')
    expect(rendered).not.toContain('/home/alice/.gemini/oauth_creds.json')
    expect(rendered).not.toContain('oauth_creds')
  })
})
