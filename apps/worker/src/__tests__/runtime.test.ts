import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectScheduledTasks } from '@owlfolio/ledger/projections/scheduledTaskProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { CertificationReport, Provider } from '@owlfolio/providers'
import type { ProviderRunRequest, ProviderToolRun } from '@owlfolio/providers/providerContract'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { describe, expect, it, vi } from 'vitest'

import { main } from '../index'
import { defineDefaultScheduledTasks, resolveWorkerProviderReadiness, resolveWorkerRuntimePaths, runScheduledTasks } from '../runtime'

function ledgerEvent(
  event_type: string,
  aggregate_type: LedgerEventEnvelope<unknown>['aggregate_type'],
  aggregate_id: string,
  payload: Record<string, unknown>,
  actor_type: LedgerEventEnvelope<unknown>['actor_type'] = 'user',
): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: `evt_${event_type}_${aggregate_id}`,
    event_type,
    aggregate_type,
    aggregate_id,
    actor_type,
    actor_id: actor_type === 'worker' ? 'owlfolio-worker' : 'user_local',
    payload,
    source_ids: [],
    created_at: '2026-06-01T07:00:00.000Z',
    schema_version: 1,
  }
}

function unsupportedCompletedReport(providerId: string): CertificationReport {
  return {
    certification_report_id: `cert_${providerId}_unsupported_completed`,
    provider_id: providerId,
    target: {
      provider_surface_id: 'mock-provider',
      vendor_id: 'mock',
      runtime_kind: 'built_in',
      auth_mode: 'built_in_demo',
      model_id: 'mock-research-v2',
      workflow_role: 'scheduled_monitoring_dry_run',
      schema_version: 1,
    },
    run_status: 'completed',
    support_level: 'unsupported',
    generated_at: '2026-06-01T00:00:00.000Z',
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'unsupported',
      'multi-step-tool-loop': 'unsupported',
      'source-grounding': 'adapter',
      'citation-metadata': 'adapter',
      'url-context': 'unsupported',
      'file-context': 'adapter',
      'source-bundle-production': 'adapter',
      'code-execution': 'unsupported',
      'computer-use': 'unsupported',
      'browser-use': 'unsupported',
    },
    cases: [],
    summary: 'Provider certification completed but is unsupported for execution.',
  }
}

function nonCompletedReport(runStatus: CertificationReport['run_status'], reason: string): CertificationReport {
  return {
    ...unsupportedCompletedReport('mock-provider'),
    certification_report_id: `cert_mock_provider_${runStatus}`,
    run_status: runStatus,
    support_level: 'certified',
    not_run_reason: reason,
    summary: `Certification did not complete: ${reason}`,
  }
}

function completedCertifiedReport(workflowRole: CertificationReport['target']['workflow_role'], modelId = 'mock-research-v2'): CertificationReport {
  return {
    ...unsupportedCompletedReport('mock-provider'),
    certification_report_id: `cert_mock_provider_${workflowRole}_${modelId}`,
    target: {
      ...unsupportedCompletedReport('mock-provider').target,
      model_id: modelId,
      workflow_role: workflowRole,
    },
    run_status: 'completed',
    support_level: 'certified',
    summary: `Mock provider certified for ${workflowRole}.`,
  }
}

class SecretLeakingProvider implements Provider {
  readonly provider_id = 'mock-provider'
  readonly capabilities = new MockProvider().capabilities

  private readonly delegate = new MockProvider()

  complete(request: ProviderRunRequest) {
    return this.delegate.complete(request)
  }

  structured<T>(request: ProviderRunRequest, schema: Parameters<Provider['structured']>[1]) {
    return this.delegate.structured(request, schema) as Promise<T>
  }

  runWithTools(_request: ProviderRunRequest): Promise<ProviderToolRun> {
    throw new Error('auth failed OPENAI_API_KEY=*** at /tmp/secret/codex/auth.json using Bearer bearer-secret-token Cookie: owl_session=fake-cookie-value session_token=fake-session-token')
  }
}

async function appendCostHolding(store: InMemoryEventStore<LedgerEventEnvelope<unknown>>): Promise<void> {
  await store.append(ledgerEvent('holding_opened', 'holding', 'holding_cost_001', {
    holding_id: 'holding_cost_001',
    watchlist_item_id: 'wl_cost_001',
    research_case_id: 'rc_cost_001',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    thesis_summary: 'Membership warehouse compounder with durable unit economics.',
    shares: 1,
    cost_basis_per_share: 812.4,
    currency: 'USD',
    opened_at: '2026-05-28',
  }))
  await store.append(ledgerEvent('holding_review_confirmed', 'holding', 'holding_cost_001', {
    review_id: 'review_cost_001',
    holding_id: 'holding_cost_001',
    research_case_id: 'rc_cost_001',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    thesis_health: 'HEALTHY',
    action_stance: 'HOLD',
    rationale: 'Thesis remains intact.',
    evidence_summary: 'Reviewed source ledger references.',
    uncertainty: 'Refresh after next filing.',
    next_review_at: '2026-06-01',
    user_approved: true,
  }))
}

describe('worker runtime', () => {
  it('loads config and resolves runtime paths without importing web UI modules', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-worker-runtime-'))
    const configPath = join(projectDir, 'config', 'app-config.json')
    await mkdir(join(projectDir, 'config'), { recursive: true })
    await writeFile(configPath, JSON.stringify({
      version: 1,
      mode: 'demo',
      provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      strategy_id: 'buffett-munger',
      shariah: {
        enabled: true,
        policy_basis: 'AAOIFI',
        allow_conditional: true,
        non_compliant_income_threshold: 0.05,
      },
      market_universe: { scope_id: 'public-equities', label: 'Public equities', broker_required: false },
      ledger_path: join(projectDir, 'runtime', 'ledger.sqlite'),
      source_ledger_path: join(projectDir, 'runtime', 'source-ledger'),
    }), 'utf8')

    const runtime = await resolveWorkerRuntimePaths({
      cwd: projectDir,
      env: { OWLFOLIO_PROJECT_DIR: projectDir, OWLFOLIO_APP_CONFIG_PATH: configPath },
    })

    expect(runtime.config_path).toBe(configPath)
    expect(runtime.ledger_path).toBe(join(projectDir, 'runtime', 'ledger.sqlite'))
    expect(runtime.source_ledger_path).toBe(join(projectDir, 'runtime', 'source-ledger'))
    expect(runtime.config.provider.provider_id).toBe('mock-provider')
  })

  it('worker CLI wires the configured provider into watchlist monitoring dry-runs', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-worker-cli-provider-'))
    const configPath = join(projectDir, 'data', 'app-config.json')
    const ledgerPath = join(projectDir, 'runtime', 'ledger.sqlite')
    const sourceLedgerPath = join(projectDir, 'runtime', 'source-ledger')
    await mkdir(join(projectDir, 'data'), { recursive: true })
    await writeFile(configPath, JSON.stringify({
      version: 1,
      mode: 'demo',
      provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      strategy_id: 'buffett-munger',
      shariah: {
        enabled: true,
        policy_basis: 'AAOIFI',
        allow_conditional: true,
        non_compliant_income_threshold: 0.05,
      },
      market_universe: { scope_id: 'public-equities', label: 'Public equities', broker_required: false },
      ledger_path: ledgerPath,
      source_ledger_path: sourceLedgerPath,
    }), 'utf8')

    const seedStore = new SQLiteEventStore<LedgerEventEnvelope<unknown>>(ledgerPath)
    await seedStore.append(ledgerEvent('watchlist_draft_created', 'watchlist_item', 'wl_cost_001', {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: false,
      thesis_summary: 'Quality compounder; wait for margin of safety.',
    }) as LedgerEventEnvelope<unknown>)
    await seedStore.append(ledgerEvent('watchlist_draft_confirmed', 'watchlist_item', 'wl_cost_001', {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: true,
    }) as LedgerEventEnvelope<unknown>)
    seedStore.close()

    const previousEnv = {
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
      OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
      OWLFOLIO_LEDGER_PATH: process.env.OWLFOLIO_LEDGER_PATH,
      OWLFOLIO_SOURCE_LEDGER_PATH: process.env.OWLFOLIO_SOURCE_LEDGER_PATH,
    }
    process.env.OWLFOLIO_PROJECT_DIR = projectDir
    process.env.OWLFOLIO_APP_CONFIG_PATH = configPath
    process.env.OWLFOLIO_LEDGER_PATH = ledgerPath
    process.env.OWLFOLIO_SOURCE_LEDGER_PATH = sourceLedgerPath
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      await expect(main(['--define-defaults', '--task-kind', 'watchlist_monitor'])).resolves.toBe(0)

      const store = new SQLiteEventStore<LedgerEventEnvelope<unknown>>(ledgerPath)
      const events = await store.list()
      store.close()
      expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining([
        'provider_run_started',
        'provider_run_completed',
        'scheduled_task_run_completed',
      ]))
      const completed = events.find((event) => event.event_type === 'scheduled_task_run_completed')
      expect(completed?.payload).toMatchObject({
        provider_run_ids: [expect.stringMatching(/^provider_run_task_watchlist_monitor_daily_\d+_wl_cost_001$/)],
        approval_gates: ['open_holding_requires_user_confirmation'],
        human_approval_required: true,
        auto_approved_actions: 0,
      })
    } finally {
      logSpy.mockRestore()
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('worker CLI fails closed before provider-backed monitoring when latest certification is unsupported', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-worker-cli-unsupported-provider-'))
    const configPath = join(projectDir, 'data', 'app-config.json')
    const ledgerPath = join(projectDir, 'runtime', 'ledger.sqlite')
    const sourceLedgerPath = join(projectDir, 'runtime', 'source-ledger')
    await mkdir(join(projectDir, 'data', 'provider-certifications'), { recursive: true })
    await writeFile(configPath, JSON.stringify({
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
      ledger_path: ledgerPath,
      source_ledger_path: sourceLedgerPath,
    }), 'utf8')
    await writeFile(
      join(projectDir, 'data', 'provider-certifications', 'mock-provider.latest.json'),
      JSON.stringify(unsupportedCompletedReport('mock-provider')),
      'utf8',
    )

    const seedStore = new SQLiteEventStore<LedgerEventEnvelope<unknown>>(ledgerPath)
    await seedStore.append(ledgerEvent('watchlist_draft_created', 'watchlist_item', 'wl_cost_001', {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: false,
      thesis_summary: 'Quality compounder; wait for margin of safety.',
    }) as LedgerEventEnvelope<unknown>)
    await seedStore.append(ledgerEvent('watchlist_draft_confirmed', 'watchlist_item', 'wl_cost_001', {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: true,
    }) as LedgerEventEnvelope<unknown>)
    seedStore.close()

    const previousEnv = {
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
      OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
      OWLFOLIO_LEDGER_PATH: process.env.OWLFOLIO_LEDGER_PATH,
      OWLFOLIO_SOURCE_LEDGER_PATH: process.env.OWLFOLIO_SOURCE_LEDGER_PATH,
    }
    process.env.OWLFOLIO_PROJECT_DIR = projectDir
    process.env.OWLFOLIO_APP_CONFIG_PATH = configPath
    process.env.OWLFOLIO_LEDGER_PATH = ledgerPath
    process.env.OWLFOLIO_SOURCE_LEDGER_PATH = sourceLedgerPath
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      await expect(main(['--define-defaults', '--task-kind', 'watchlist_monitor'])).resolves.toBe(1)

      const store = new SQLiteEventStore<LedgerEventEnvelope<unknown>>(ledgerPath)
      const events = await store.list()
      store.close()
      expect(events.map((event) => event.event_type)).toContain('scheduled_task_run_failed')
      expect(events.map((event) => event.event_type)).not.toContain('provider_run_started')
      const failed = events.find((event) => event.event_type === 'scheduled_task_run_failed')
      expect(failed?.payload).toMatchObject({
        error_summary: expect.stringContaining('Provider mock-provider is not ready'),
      })
    } finally {
      logSpy.mockRestore()
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('worker readiness fails closed for non-completed certification statuses and scheduled-unsupported providers', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-worker-readiness-gates-'))
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })

    await writeFile(join(reportDir, 'mock-provider.latest.json'), JSON.stringify(nonCompletedReport(
      'reauth-required',
      'reauth failed at /tmp/secret/codex/auth.json with CODEX_ACCESS_TOKEN=***',
    )), 'utf8')
    const reauthReadiness = await resolveWorkerProviderReadiness({
      provider_id: 'mock-provider',
      provider_certification_dir: reportDir,
    })
    expect(reauthReadiness).toMatchObject({ is_ready: false, auth_mode: 'built_in_demo' })
    expect(reauthReadiness.status_label).toContain('[redacted-path]')
    expect(reauthReadiness.status_label).not.toContain('/tmp/secret/codex/auth.json')
    expect(reauthReadiness.status_label).not.toContain('***')

    await writeFile(join(reportDir, 'mock-provider.latest.json'), JSON.stringify(nonCompletedReport(
      'quota-limited',
      'quota exhausted for Bearer bearer-secret-token',
    )), 'utf8')
    const quotaReadiness = await resolveWorkerProviderReadiness({
      provider_id: 'mock-provider',
      provider_certification_dir: reportDir,
    })
    expect(quotaReadiness).toMatchObject({ is_ready: false })
    expect(quotaReadiness.status_label).not.toContain('bearer-secret-token')

    const cliReadiness = await resolveWorkerProviderReadiness({
      provider_id: 'openai',
      provider_certification_dir: reportDir,
    })
    expect(cliReadiness).toMatchObject({
      is_ready: false,
      provider_surface_id: 'openai-codex-cli',
      runtime_kind: 'cli',
      auth_mode: 'cli_cached_session',
    })
    expect(cliReadiness.status_label).toMatch(/not certified for scheduled workflows/i)
  })

  it('worker readiness requires certification target to match scheduled monitoring execution', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-worker-target-match-'))
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })

    await writeFile(
      join(reportDir, 'mock-provider.latest.json'),
      JSON.stringify(completedCertifiedReport('research_draft')),
      'utf8',
    )
    const wrongRoleReadiness = await resolveWorkerProviderReadiness({
      provider_id: 'mock-provider',
      provider_certification_dir: reportDir,
    })
    expect(wrongRoleReadiness).toMatchObject({
      is_ready: false,
      workflow_role: 'research_draft',
    })
    expect(wrongRoleReadiness.status_label).toMatch(/scheduled_monitoring_dry_run/i)

    await writeFile(
      join(reportDir, 'mock-provider.latest.json'),
      JSON.stringify(completedCertifiedReport('scheduled_monitoring_dry_run')),
      'utf8',
    )
    const scheduledReadiness = await resolveWorkerProviderReadiness({
      provider_id: 'mock-provider',
      provider_certification_dir: reportDir,
    })
    expect(scheduledReadiness).toMatchObject({
      is_ready: true,
      workflow_role: 'scheduled_monitoring_dry_run',
    })
  })

  it('worker readiness backfills target metadata for legacy built-in demo certification reports', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-worker-legacy-certification-'))
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    const { target: _target, ...legacyReport } = completedCertifiedReport(
      'scheduled_monitoring_dry_run',
      'mock-buffett-munger-demo',
    )

    await writeFile(
      join(reportDir, 'mock-provider.latest.json'),
      JSON.stringify(legacyReport),
      'utf8',
    )

    const readiness = await resolveWorkerProviderReadiness({
      provider_id: 'mock-provider',
      provider_certification_dir: reportDir,
      provider_model_id: 'mock-buffett-munger-demo',
    })

    expect(readiness).toMatchObject({
      is_ready: true,
      provider_surface_id: 'mock-provider',
      vendor_id: 'mock',
      runtime_kind: 'built_in',
      auth_mode: 'built_in_demo',
      workflow_role: 'scheduled_monitoring_dry_run',
    })
    expect(readiness.status_label).toBe('Mock provider certified for scheduled_monitoring_dry_run.')
  })

  it('worker readiness blocks certification reports for a mismatched scheduled model target', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-worker-model-target-'))
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    await writeFile(
      join(reportDir, 'mock-provider.latest.json'),
      JSON.stringify(completedCertifiedReport('scheduled_monitoring_dry_run', 'different-model')),
      'utf8',
    )

    const readiness = await resolveWorkerProviderReadiness({
      provider_id: 'mock-provider',
      provider_certification_dir: reportDir,
      provider_model_id: 'mock-research-v2',
    })
    expect(readiness).toMatchObject({ is_ready: false })
    expect(readiness.status_label).toMatch(/model/i)
    expect(readiness.status_label).toMatch(/scheduled provider execution is blocked/i)
  })

  it('redacts provider errors in scheduled run ledger payloads and result summaries', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('watchlist_draft_created', 'watchlist_item', 'wl_cost_001', {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: false,
      thesis_summary: 'Quality compounder; wait for margin of safety.',
    }))
    await store.append(ledgerEvent('watchlist_draft_confirmed', 'watchlist_item', 'wl_cost_001', {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: true,
    }))
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T09:00:00.000Z' })

    const result = await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      provider: new SecretLeakingProvider(),
      provider_readiness: {
        provider_id: 'mock-provider',
        is_ready: true,
        status_label: 'Mock provider certified for scheduled monitoring.',
        provider_surface_id: 'mock-provider',
        vendor_id: 'mock',
        runtime_kind: 'built_in',
        auth_mode: 'built_in_demo',
        workflow_role: 'scheduled_monitoring_dry_run',
      },
      provider_model_id: 'mock-buffett-munger-monitor',
      now: () => '2026-06-01T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_redaction_001',
    })

    expect(result).toMatchObject({ failed: 1 })
    const serializedResult = JSON.stringify(result)
    const events = await store.list()
    const serializedEvents = JSON.stringify(events)
    const providerFailed = events.find((event) => event.event_type === 'provider_run_failed')
    const scheduledFailed = events.find((event) => event.event_type === 'scheduled_task_run_failed')

    expect(providerFailed?.payload).toMatchObject({
      provider_surface_id: 'mock-provider',
      vendor_id: 'mock',
      runtime_kind: 'built_in',
      auth_mode: 'built_in_demo',
      workflow_role: 'scheduled_monitoring_dry_run',
      error_summary: expect.stringContaining('[redacted-secret]'),
    })
    expect(scheduledFailed?.payload).toMatchObject({
      error_summary: expect.stringContaining('[redacted-secret]'),
    })
    for (const serialized of [serializedResult, serializedEvents]) {
      expect(serialized).not.toContain('/tmp/secret/codex/auth.json')
      expect(serialized).not.toContain('***')
      expect(serialized).not.toContain('bearer-secret-token')
      expect(serialized).not.toContain('fake-cookie-value')
      expect(serialized).not.toContain('fake-session-token')
    }
  })

  it('defines safe default dry-run tasks idempotently', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()

    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T08:00:00.000Z' })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T08:00:00.000Z' })

    const definitions = (await store.list()).filter((event) => event.event_type === 'scheduled_task_defined')
    expect(definitions).toHaveLength(3)
    expect(definitions.map((event) => event.payload)).toEqual([
      expect.objectContaining({ task_kind: 'review_reminder', dry_run: true, enabled: true }),
      expect.objectContaining({ task_kind: 'watchlist_monitor', dry_run: true, enabled: true }),
      expect.objectContaining({
        task_kind: 'holding_review_draft',
        dry_run: true,
        enabled: true,
        timeout_ms: 120_000,
        max_cost_usd: 0.25,
      }),
    ])
  })

  it('runs due review reminder tasks as dry-runs without auto-approving investment actions', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_cost_001', {
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      shares: 1,
      cost_basis_per_share: 812.4,
      currency: 'USD',
      opened_at: '2026-05-28',
    }))
    await store.append(ledgerEvent('holding_review_confirmed', 'holding', 'holding_cost_001', {
      review_id: 'review_cost_001',
      holding_id: 'holding_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_health: 'HEALTHY',
      action_stance: 'HOLD',
      rationale: 'Thesis remains intact.',
      evidence_summary: 'Reviewed source ledger references.',
      uncertainty: 'Refresh after next filing.',
      next_review_at: '2026-06-01',
      user_approved: true,
    }))
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T08:00:00.000Z' })

    const result = await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'review_reminder',
      now: () => '2026-06-01T08:00:00.000Z',
      run_id: () => 'run_review_reminder_001',
    })

    expect(result).toMatchObject({ completed: 1, failed: 0 })
    const events = await store.list()
    expect(events.map((event) => event.event_type)).toContain('scheduled_task_run_started')
    expect(events.map((event) => event.event_type)).toContain('scheduled_task_run_completed')
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'holding_review_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'holding_opened', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'watchlist_draft_confirmed', actor_type: 'worker' }),
    ]))
    expect(events.at(-1)?.payload).toMatchObject({
      auto_approved_actions: 0,
      result_summary: expect.stringContaining('no investment action taken'),
    })
  })

  it('generates review reminders for holdings and confirmed watchlist items without approving actions', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_cost_001', {
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      shares: 1,
      cost_basis_per_share: 812.4,
      currency: 'USD',
      opened_at: '2026-05-28',
    }))
    await store.append(ledgerEvent('holding_review_confirmed', 'holding', 'holding_cost_001', {
      review_id: 'review_cost_001',
      holding_id: 'holding_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_health: 'HEALTHY',
      action_stance: 'HOLD',
      rationale: 'Thesis remains intact.',
      evidence_summary: 'Reviewed source ledger references.',
      uncertainty: 'Refresh after next filing.',
      next_review_at: '2026-06-01',
      user_approved: true,
    }))
    await store.append(ledgerEvent('watchlist_draft_created', 'watchlist_item', 'wl_msft_001', {
      watchlist_item_id: 'wl_msft_001',
      research_case_id: 'rc_msft_001',
      ticker: 'MSFT',
      user_approved: false,
      thesis_summary: 'Quality compounder; wait for margin of safety.',
    }))
    await store.append(ledgerEvent('watchlist_draft_confirmed', 'watchlist_item', 'wl_msft_001', {
      watchlist_item_id: 'wl_msft_001',
      research_case_id: 'rc_msft_001',
      ticker: 'MSFT',
      user_approved: true,
    }))
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T08:00:00.000Z' })

    await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'review_reminder',
      now: () => '2026-06-01T08:00:00.000Z',
      run_id: () => 'run_review_reminder_002',
    })

    const events = await store.list()
    const completed = events.find((event) => event.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      result_summary: 'review_reminder dry-run: 1 due holding review(s), 0 upcoming holding review(s), 1 confirmed watchlist review reminder(s); no investment action taken',
      observations: [
        'holding COST is due for review',
        'watchlist MSFT should be reviewed for buy-zone/thesis changes; opening a holding requires user approval',
      ],
      approval_gates: ['holding_review_requires_user_confirmation', 'open_holding_requires_user_confirmation'],
      human_approval_required: true,
      auto_approved_actions: 0,
    })
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'holding_review_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'holding_opened', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'watchlist_draft_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'purification_payment_recorded', actor_type: 'worker' }),
    ]))
  })

  it('runs watchlist monitoring as a mock-safe dry-run', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('watchlist_draft_created', 'watchlist_item', 'wl_msft_001', {
      watchlist_item_id: 'wl_msft_001',
      research_case_id: 'rc_msft_001',
      ticker: 'MSFT',
      user_approved: false,
      thesis_summary: 'Quality compounder; wait for margin of safety.',
    }))
    await store.append(ledgerEvent('watchlist_draft_confirmed', 'watchlist_item', 'wl_msft_001', {
      watchlist_item_id: 'wl_msft_001',
      research_case_id: 'rc_msft_001',
      ticker: 'MSFT',
      user_approved: true,
    }))
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T09:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      now: () => '2026-06-01T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_001',
    })

    const completed = (await store.list()).find((event) => event.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      result_summary: 'watchlist_monitor dry-run: 1 confirmed watchlist item(s) monitored; no buy/sell/portfolio action taken',
      observations: ['MSFT remains on the confirmed watchlist for mock-safe monitoring'],
      approval_gates: ['open_holding_requires_user_confirmation'],
      human_approval_required: true,
      auto_approved_actions: 0,
    })
  })

  it('can run watchlist monitoring through a provider path while requiring human approval before portfolio changes', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('watchlist_draft_created', 'watchlist_item', 'wl_cost_001', {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: false,
      thesis_summary: 'Quality compounder; wait for margin of safety.',
    }))
    await store.append(ledgerEvent('watchlist_draft_confirmed', 'watchlist_item', 'wl_cost_001', {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: true,
    }))
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T09:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      provider: new MockProvider(),
      provider_readiness: {
        provider_id: 'mock-provider',
        is_ready: true,
        status_label: 'Mock provider certified for test execution.',
        provider_surface_id: 'mock-provider',
        vendor_id: 'mock',
        runtime_kind: 'built_in',
        auth_mode: 'built_in_demo',
        workflow_role: 'scheduled_monitoring_dry_run',
      },
      provider_model_id: 'mock-buffett-munger-monitor',
      now: () => '2026-06-01T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_provider_001',
    })

    const events = await store.list()
    expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining([
      'provider_run_started',
      'provider_run_completed',
      'scheduled_task_run_completed',
    ]))
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'holding_opened', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'watchlist_draft_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'purification_payment_recorded', actor_type: 'worker' }),
    ]))

    const providerCompleted = events.find((event) => event.event_type === 'provider_run_completed')
    expect(providerCompleted).toMatchObject({
      aggregate_type: 'provider_run',
      actor_type: 'provider',
      actor_id: 'mock-provider',
      payload: expect.objectContaining({
        provider_id: 'mock-provider',
        provider_surface_id: 'mock-provider',
        vendor_id: 'mock',
        runtime_kind: 'built_in',
        auth_mode: 'built_in_demo',
        workflow_role: 'scheduled_monitoring_dry_run',
        model_id: 'mock-buffett-munger-monitor',
        finish_reason: 'tool-calls',
        human_approval_required: true,
        approval_gates: ['open_holding_requires_user_confirmation'],
        auto_approved_actions: 0,
      }),
    })

    const completed = events.find((event) => event.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      provider_run_ids: ['provider_run_watchlist_monitor_provider_001_wl_cost_001'],
      approval_gates: ['open_holding_requires_user_confirmation'],
      human_approval_required: true,
      auto_approved_actions: 0,
    })
    const projectedWatchlistTask = projectScheduledTasks(events).find((task) => task.task_kind === 'watchlist_monitor')
    expect(projectedWatchlistTask).toMatchObject({
      last_provider_run_ids: ['provider_run_watchlist_monitor_provider_001_wl_cost_001'],
      approval_gates: ['open_holding_requires_user_confirmation'],
      human_approval_required: true,
      auto_approved_actions: 0,
    })
  })

  it('creates provider-authored holding review draft proposals without approval writes', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T10:00:00.000Z' })

    const result = await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'holding_review_draft',
      provider: new MockProvider(),
      provider_readiness: {
        provider_id: 'mock-provider',
        is_ready: true,
        status_label: 'Mock provider certified for scheduled monitoring.',
        provider_surface_id: 'mock-provider',
        vendor_id: 'mock',
        runtime_kind: 'built_in',
        auth_mode: 'built_in_demo',
        workflow_role: 'scheduled_monitoring_dry_run',
      },
      provider_model_id: 'mock-buffett-munger-monitor',
      now: () => '2026-06-01T10:00:00.000Z',
      run_id: () => 'run_holding_review_draft_001',
    })

    expect(result).toMatchObject({ completed: 1, failed: 0 })
    const events = await store.list()
    const reviewDrafted = events.find((event) => event.event_type === 'holding_review_drafted')
    expect(reviewDrafted).toMatchObject({
      aggregate_type: 'holding',
      aggregate_id: 'holding_cost_001',
      actor_type: 'provider',
      actor_id: 'mock-provider',
      causation_id: 'evt_scheduled_task_run_started_run_holding_review_draft_001',
      correlation_id: 'holding_cost_001',
      payload: expect.objectContaining({
        holding_id: 'holding_cost_001',
        user_approved: false,
        reviewed_by_actor_type: 'provider',
        reviewed_by_actor_id: 'mock-provider',
      }),
    })
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'holding_review_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'holding_review_overridden', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'holding_opened', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'watchlist_draft_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'shariah_gate_decision_recorded', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'purification_payment_recorded', actor_type: 'worker' }),
    ]))
    const started = events.find((event) => event.event_type === 'scheduled_task_run_started')
    expect(started?.payload).toMatchObject({
      timeout_ms: 120_000,
      max_cost_usd: 0.25,
      dry_run: true,
    })
    const completed = events.find((event) => event.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      result_summary: 'holding_review_draft dry-run: 1 holding review draft proposal(s) created; no holding review confirmation or portfolio action taken',
      proposal_event_ids: ['evt_holding_review_drafted_review_holding_cost_001_20260601'],
      approval_gates: ['holding_review_requires_user_confirmation'],
      human_approval_required: true,
      auto_approved_actions: 0,
      dry_run: true,
    })
  })

  it('fails closed before holding review draft proposals when provider readiness is missing', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T10:00:00.000Z' })

    const result = await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'holding_review_draft',
      now: () => '2026-06-01T10:00:00.000Z',
      run_id: () => 'run_holding_review_draft_missing_provider_001',
    })

    expect(result).toMatchObject({ completed: 0, failed: 1 })
    const events = await store.list()
    expect(events.map((event) => event.event_type)).not.toContain('holding_review_drafted')
    expect(events.map((event) => event.event_type)).not.toContain('provider_run_started')
    const failed = events.find((event) => event.event_type === 'scheduled_task_run_failed')
    expect(failed?.payload).toMatchObject({
      error_summary: expect.stringContaining('holding_review_draft requires a certified provider readiness check'),
      retry_after: '2026-06-01T10:05:00.000Z',
      dry_run: true,
    })
  })

  it('records failed runs with retry metadata for unsupported task kinds', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_experimental_live_trade', {
      scheduled_task_id: 'task_experimental_live_trade',
      task_kind: 'experimental_live_trade',
      cadence: '*/5 * * * *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2 },
    }))

    const result = await runScheduledTasks(store, {
      dry_run: true,
      now: () => '2026-06-01T09:00:00.000Z',
      run_id: () => 'run_unsupported_001',
    })

    expect(result).toMatchObject({ completed: 0, failed: 1 })
    const failed = (await store.list()).find((event) => event.event_type === 'scheduled_task_run_failed')
    expect(failed?.payload).toMatchObject({
      scheduled_task_id: 'task_experimental_live_trade',
      run_id: 'run_unsupported_001',
      error_summary: 'Unsupported scheduled task kind: experimental_live_trade',
      attempt: 1,
      max_attempts: 2,
      retry_after: '2026-06-01T09:05:00.000Z',
    })
  })

  it('skips failed tasks before their retry window opens', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_experimental_live_trade', {
      scheduled_task_id: 'task_experimental_live_trade',
      task_kind: 'experimental_live_trade',
      cadence: '*/5 * * * *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2 },
    }))
    await runScheduledTasks(store, {
      dry_run: true,
      now: () => '2026-06-01T09:00:00.000Z',
      run_id: () => 'run_unsupported_001',
    })

    const result = await runScheduledTasks(store, {
      dry_run: true,
      now: () => '2026-06-01T09:01:00.000Z',
      run_id: () => 'run_unsupported_002',
    })

    expect(result).toMatchObject({ considered: 1, completed: 0, failed: 0, skipped: 1 })
    expect(result.summaries).toEqual([
      'task_experimental_live_trade skipped: retry opens at 2026-06-01T09:05:00.000Z',
    ])
    expect((await store.list()).filter((event) => event.event_type === 'scheduled_task_run_started')).toHaveLength(1)
  })

  it('skips failed tasks after retry attempts are exhausted', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_experimental_live_trade', {
      scheduled_task_id: 'task_experimental_live_trade',
      task_kind: 'experimental_live_trade',
      cadence: '*/5 * * * *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2 },
    }))
    await runScheduledTasks(store, {
      dry_run: true,
      now: () => '2026-06-01T09:00:00.000Z',
      run_id: () => 'run_unsupported_001',
    })
    await runScheduledTasks(store, {
      dry_run: true,
      now: () => '2026-06-01T09:05:00.000Z',
      run_id: () => 'run_unsupported_002',
    })

    const result = await runScheduledTasks(store, {
      dry_run: true,
      now: () => '2026-06-01T09:10:00.000Z',
      run_id: () => 'run_unsupported_003',
    })

    expect(result).toMatchObject({ considered: 1, completed: 0, failed: 0, skipped: 1 })
    expect(result.summaries).toEqual([
      'task_experimental_live_trade skipped: retry attempts exhausted after 2 failure(s)',
    ])
    expect((await store.list()).filter((event) => event.event_type === 'scheduled_task_run_started')).toHaveLength(2)
  })
})
