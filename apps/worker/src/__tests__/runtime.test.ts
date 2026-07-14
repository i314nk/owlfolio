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
import type { PriceQuote, PriceQuoteSymbol, PriceSource } from '@owlfolio/workflow/marketData'
import { defaultAutomationSettings } from '@owlfolio/shared'
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


function makeMockPriceSource(prices: Record<string, PriceQuote>): PriceSource {
  return {
    id: 'mock-price-source',
    getQuote(symbol: PriceQuoteSymbol): Promise<PriceQuote> {
      const key = symbol.ticker.toUpperCase()
      const quote = prices[key] ?? { available: false as const, reason: 'no mock price', source: 'mock-price-source' }
      return Promise.resolve(quote)
    },
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

  // SCALE-DOWN S2: the valuation leg is retired — the task is the held-ticker PRICE POLL now.
  it('the rescoped portfolio_valuation_refresh records price snapshots and NO holding valuations', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_pvr', {
      scheduled_task_id: 'task_pvr',
      task_kind: 'portfolio_valuation_refresh',
      cadence: '0 6 * * *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: 300_000 },
    }))
    const result = await runScheduledTasks(store, {
      dry_run: true,
      now: () => '2026-07-01T06:01:00.000Z',
      run_id: () => 'run_pvr_rescope',
      priceSource: makeMockPriceSource({ COST: { available: true, price_per_share: 120, currency: 'USD', as_of: '2026-07-01T00:00:00.000Z', source: 'mock-price-source' } }),
    })
    expect(result.completed).toBe(1)
    const events = await store.list()
    expect(events.some((e) => e.event_type === 'price_snapshot_recorded')).toBe(true)
    expect(events.some((e) => e.event_type === 'holding_valuation_recorded')).toBe(false)
    expect(result.summaries.join(' ')).toMatch(/price snapshot/i)
  })
  it('loads config and resolves runtime paths without importing web UI modules', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-worker-runtime-'))
    const configPath = join(projectDir, 'config', 'app-config.json')
    await mkdir(join(projectDir, 'config'), { recursive: true })
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

    const openRouterReadiness = await resolveWorkerProviderReadiness({
      provider_id: 'openrouter',
      provider_certification_dir: reportDir,
    })
    expect(openRouterReadiness).toMatchObject({
      is_ready: false,
      provider_surface_id: 'openrouter-api',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
    })
    expect(openRouterReadiness.status_label).toMatch(/not certified for scheduled workflows/i)
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
    expect(definitions).toHaveLength(9)
    expect(definitions.map((event) => event.payload)).toEqual([
      expect.objectContaining({ task_kind: 're_review_check', cadence: '0 6 1 */3 *', dry_run: true, enabled: true }),
      expect.objectContaining({ task_kind: 'watchlist_monitor', dry_run: true, enabled: true }),
      expect.objectContaining({ task_kind: 'holdings_monitor', dry_run: true, enabled: true }),
      expect.objectContaining({
        task_kind: 'shariah_rescreen',
        cadence: '0 6 1 */3 *',
        dry_run: true,
        enabled: true,
        safety: expect.objectContaining({
          auto_approve_investment_actions: false,
          auto_approve_portfolio_actions: false,
        }),
      }),
      expect.objectContaining({
        task_kind: 'portfolio_valuation_refresh',
        dry_run: true,
        enabled: true,
        safety: expect.objectContaining({
          auto_approve_investment_actions: false,
          auto_approve_portfolio_actions: false,
        }),
      }),
      expect.objectContaining({
        task_kind: 'forecast_resolution',
        dry_run: true,
        enabled: true,
        safety: expect.objectContaining({
          auto_approve_investment_actions: false,
          auto_approve_portfolio_actions: false,
        }),
      }),
      expect.objectContaining({
        task_kind: 'discovery_13f',
        cadence: '0 6 1 */3 *',
        dry_run: true,
        safety: expect.objectContaining({
          auto_approve_investment_actions: false,
          auto_approve_portfolio_actions: false,
        }),
      }),
      expect.objectContaining({
        task_kind: 'falsifier_check',
        cadence: '0 6 1 */3 *',
        dry_run: true,
        enabled: true,
        safety: expect.objectContaining({
          auto_approve_investment_actions: false,
          auto_approve_portfolio_actions: false,
        }),
      }),
      expect.objectContaining({
        task_kind: 're_underwrite',
        cadence: '0 6 1 1 *',
        dry_run: true,
        enabled: true,
        safety: expect.objectContaining({
          auto_approve_investment_actions: false,
          auto_approve_portfolio_actions: false,
        }),
      }),
    ])
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
      // The buy-window pass adds an observation but emits no alert event (no linked research-case buy price).
      result_summary: 'watchlist_monitor dry-run: 1 confirmed watchlist item(s) monitored; 0 buy-window alert(s), 0 monitor observation(s); no buy/sell/portfolio action taken',
      observations: [
        'MSFT remains on the confirmed watchlist for mock-safe monitoring',
        'MSFT: no linked research case buy price — buy-window not evaluated',
      ],
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

  it('completes watchlist monitoring on an EMPTY watchlist even when the provider is not scheduled-certified', async () => {
    // Real-instance BUG-1: a personal_local_interactive provider (e.g. Codex/Claude) is NOT
    // scheduled-certified, so its execution readiness is_ready:false. With ZERO confirmed watchlist items
    // there is no provider work to do, so the tick must complete via the deterministic pass — not fail.
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-12T09:00:00.000Z' })

    const result = await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      provider: new MockProvider(),
      provider_readiness: {
        provider_id: 'mock-provider',
        is_ready: false,
        status_label: 'OpenAI Codex CLI is not certified for scheduled workflows (personal_local_interactive)',
        provider_surface_id: 'mock-provider',
        vendor_id: 'mock',
        runtime_kind: 'built_in',
        auth_mode: 'built_in_demo',
        workflow_role: 'scheduled_monitoring_dry_run',
      },
      now: () => '2026-06-12T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_empty_unready_001',
    })

    expect(result).toMatchObject({ completed: 1, failed: 0 })
    const events = await store.list()
    const eventTypes = events.map((event) => event.event_type)
    expect(eventTypes).toContain('scheduled_task_run_completed')
    expect(eventTypes).not.toContain('scheduled_task_run_failed')
    // The provider was never invoked (nothing to monitor) so the readiness assert never fired.
    expect(eventTypes).not.toContain('provider_run_started')
    const completed = events.find((event) => event.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      result_summary: 'watchlist_monitor dry-run: 0 confirmed watchlist item(s) monitored; 0 buy-window alert(s), 0 monitor observation(s); no buy/sell/portfolio action taken',
    })
  })

  it('runs the deterministic buy-window pass even when confirmed items make the not-ready provider fail closed', async () => {
    // Real-instance BUG-1 (companion): the deterministic, provider-free buy-window pass must run regardless
    // of the provider. With confirmed items + a not-ready provider, the provider-backed drafting still
    // fails closed (deliberate safety), but the deterministic alert is recorded FIRST — it no longer
    // depends on the provider readiness gate the way it did before the fix.
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await watchlistWithBuyPrice(store, { ticker: 'CPRT', buyPrice: 100, fairValue: 140, caseUpdatedAt: '2026-03-01T00:00:00.000Z' })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-12T09:00:00.000Z' })

    const result = await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      provider: new MockProvider(),
      provider_readiness: {
        provider_id: 'mock-provider',
        is_ready: false,
        status_label: 'OpenAI Codex CLI is not certified for scheduled workflows (personal_local_interactive)',
        provider_surface_id: 'mock-provider',
        vendor_id: 'mock',
        runtime_kind: 'built_in',
        auth_mode: 'built_in_demo',
        workflow_role: 'scheduled_monitoring_dry_run',
      },
      now: () => '2026-06-12T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_items_unready_001',
      priceSource: makeMockPriceSource({ CPRT: { available: true, price_per_share: 90, currency: 'USD', as_of: '2026-06-12T00:00:00.000Z', source: 'mock-price-source' } }),
    })

    // Confirmed item + not-ready provider keeps the fail-closed safety property on provider-backed work.
    expect(result).toMatchObject({ failed: 1 })
    const events = await store.list()
    const eventTypes = events.map((event) => event.event_type)
    // The provider was never invoked (gate threw before drafting).
    expect(eventTypes).not.toContain('provider_run_started')
    // ...but the deterministic buy-window pass already recorded its alert before the gate fired.
    const alert = events.find((event) => event.event_type === 'watchlist_monitor_alert_recorded')
    expect(alert?.payload).toMatchObject({ ticker: 'CPRT', alert_kind: 'buy_window', buy_window_alert: true })
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



  it('automation settings: disabling watchlist_monitoring sets watchlist_monitor task enabled=false', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    const disabledWatchlist = {
      ...defaultAutomationSettings(),
      watchlist_monitoring: { enabled: false, cadence: 'off' as const },
    }
    await defineDefaultScheduledTasks(store, {
      now: () => '2026-06-08T08:00:00.000Z',
      automation: disabledWatchlist,
    })

    const tasks = projectScheduledTasks(await store.list())
    const watchlistTask = tasks.find((t) => t.task_kind === 'watchlist_monitor')
    expect(watchlistTask).toBeDefined()
    expect(watchlistTask?.enabled).toBe(false)
  })

  // REVIEW RETIRED (owner, 2026-07-14): thesis_review now drives ONLY the quarterly re_review_check.
  it('automation settings: disabling thesis_review sets the re_review_check task enabled=false (no review tasks exist)', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    const disabledReviews = {
      ...defaultAutomationSettings(),
      thesis_review: { enabled: false, cadence: 'off' as const },
    }
    await defineDefaultScheduledTasks(store, {
      now: () => '2026-06-08T08:00:00.000Z',
      automation: disabledReviews,
    })

    const tasks = projectScheduledTasks(await store.list())
    expect(tasks.find((t) => t.task_kind === 're_review_check')?.enabled).toBe(false)
    expect(tasks.some((t) => t.task_kind === 'holding_review_draft')).toBe(false)
    expect(tasks.some((t) => t.task_kind === 'review_reminder')).toBe(false)
  })

  it('automation settings: disabling purification sets the shariah_rescreen task enabled=false (the cron config it rides)', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    const disabledPurification = {
      ...defaultAutomationSettings(),
      purification: { enabled: false, cadence: 'off' as const },
    }
    await defineDefaultScheduledTasks(store, {
      now: () => '2026-06-08T08:00:00.000Z',
      automation: disabledPurification,
    })

    const tasks = projectScheduledTasks(await store.list())
    const purificationTask = tasks.find((t) => t.task_kind === 'shariah_rescreen')
    expect(purificationTask?.enabled).toBe(false)
  })

  it('automation settings: changing price_refresh cadence to weekly updates the portfolio_valuation_refresh task cadence', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    const weeklyCadence = {
      ...defaultAutomationSettings(),
      price_refresh: { enabled: true, cadence: 'weekly' as const },
    }
    await defineDefaultScheduledTasks(store, {
      now: () => '2026-06-08T08:00:00.000Z',
      automation: weeklyCadence,
    })

    const tasks = projectScheduledTasks(await store.list())
    const valuationTask = tasks.find((t) => t.task_kind === 'portfolio_valuation_refresh')
    expect(valuationTask?.enabled).toBe(true)
    // Weekly cron is '0 8 * * 1'
    expect(valuationTask?.cadence).toBe('0 8 * * 1')
  })

  it('automation settings: defaults produce the same tasks as calling without options (back-compat)', async () => {
    const storeDefault = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    const storeExplicit = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()

    const now = () => '2026-06-08T08:00:00.000Z'
    await defineDefaultScheduledTasks(storeDefault, { now })
    await defineDefaultScheduledTasks(storeExplicit, { now, automation: defaultAutomationSettings() })

    const defaultTasks = projectScheduledTasks(await storeDefault.list())
    const explicitTasks = projectScheduledTasks(await storeExplicit.list())

    expect(defaultTasks.map((t) => ({ kind: t.task_kind, enabled: t.enabled, cadence: t.cadence }))).toEqual(
      explicitTasks.map((t) => ({ kind: t.task_kind, enabled: t.enabled, cadence: t.cadence })),
    )
  })

})

// ---------------------------------------------------------------------------
// Lifecycle Monitors — worker wiring (Module 6 buy-window + Module 7 holdings)
// ---------------------------------------------------------------------------

function watchlistWithBuyPrice(
  store: InMemoryEventStore<LedgerEventEnvelope<unknown>>,
  args: { ticker: string; buyPrice: number; fairValue: number; caseUpdatedAt: string; superseded?: boolean },
): Promise<unknown> {
  const itemId = `wl_${args.ticker.toLowerCase()}_001`
  const caseId = `rc_${args.ticker.toLowerCase()}_001`
  return (async () => {
    // A research-case analysis carrying the buy price + a gate-clean verdict.
    await store.append({
      ...ledgerEvent('buffett_munger_analysis_drafted', 'research_case', caseId, {
        research_case_id: caseId,
        ticker: args.ticker,
        investment_verdict: 'WATCH',
        shariah_status: 'PASS',
        valuation: {
          moat_class: 'wide',
          buy_price_per_share: args.buyPrice,
          fair_value_per_share: args.fairValue,
          verdict_state: { state: 'BUY-WINDOW' },
        },
      }, 'system'),
      created_at: args.caseUpdatedAt,
    })
    await store.append({
      ...ledgerEvent('watchlist_draft_created', 'watchlist_item', itemId, {
        watchlist_item_id: itemId,
        research_case_id: caseId,
        ticker: args.ticker,
        user_approved: false,
      }),
      created_at: args.caseUpdatedAt,
    })
    await store.append({
      ...ledgerEvent('watchlist_draft_confirmed', 'watchlist_item', itemId, {
        watchlist_item_id: itemId,
        research_case_id: caseId,
        ticker: args.ticker,
        user_approved: true,
      }),
      created_at: args.caseUpdatedAt,
    })
    if (args.superseded === true) {
      // A NEWER research-case version supersedes the watchlist-referenced case (the supersedes link is
      // carried on research_case_created, where the projection reads it). The watchlist item still
      // references the original (now superseded) case via research_case_id, so its monitor view is stale.
      await store.append({
        ...ledgerEvent('research_case_created', 'research_case', `${caseId}_v2`, {
          research_case_id: `${caseId}_v2`,
          supersedes_research_case_id: caseId,
          ticker: args.ticker,
        }, 'system'),
        created_at: args.caseUpdatedAt,
      })
    }
  })()
}

describe('worker runtime — lifecycle monitors', () => {
  it('records a BUY-WINDOW alert on a fresh, gate-clean, cheap watchlist case and never opens a holding', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await watchlistWithBuyPrice(store, { ticker: 'CPRT', buyPrice: 100, fairValue: 140, caseUpdatedAt: '2026-03-01T00:00:00.000Z' })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-10T09:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      now: () => '2026-06-10T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_bw_001',
      priceSource: makeMockPriceSource({ CPRT: { available: true, price_per_share: 90, currency: 'USD', as_of: '2026-06-10T00:00:00.000Z', source: 'mock-price-source' } }),
    })

    const events = await store.list()
    const alert = events.find((event) => event.event_type === 'watchlist_monitor_alert_recorded')
    expect(alert?.payload).toMatchObject({
      ticker: 'CPRT',
      alert_kind: 'buy_window',
      buy_window_alert: true,
      suppressed: false,
      discount_to_buy_pct: 10,
      is_observation: true,
      is_recommendation: false,
    })
    expect(alert?.actor_type).toBe('worker')
    // No state advance / no holding opened.
    expect(events.map((event) => event.event_type)).not.toContain('holding_opened')
  })

  it('SUPPRESSES the buy alert when the case is stale (>12mo) even though price is cheap', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await watchlistWithBuyPrice(store, { ticker: 'STALE', buyPrice: 100, fairValue: 140, caseUpdatedAt: '2024-12-01T00:00:00.000Z' })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-10T09:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      now: () => '2026-06-10T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_stale_001',
      priceSource: makeMockPriceSource({ STALE: { available: true, price_per_share: 80, currency: 'USD', as_of: '2026-06-10T00:00:00.000Z', source: 'mock-price-source' } }),
    })

    const alert = (await store.list()).find((event) => event.event_type === 'watchlist_monitor_alert_recorded')
    expect(alert?.payload).toMatchObject({
      alert_kind: 'buy_window_suppressed',
      buy_window_alert: false,
      suppressed: true,
      rerun_needed: true,
    })
    expect((alert?.payload as { suppression_reason?: string }).suppression_reason).toMatch(/stale cheapness is not a signal/)
  })

  it('records a thesis-gated tranche-review + concentration alert and never auto-trades', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    // Research case for the holding with a buy price anchoring the tranche ladder.
    await store.append({
      ...ledgerEvent('buffett_munger_analysis_drafted', 'research_case', 'rc_cost_001', {
        research_case_id: 'rc_cost_001',
        ticker: 'COST',
        investment_verdict: 'WATCH',
        shariah_status: 'PASS',
        valuation: { moat_class: 'wide', buy_price_per_share: 100, fair_value_per_share: 140 },
      }, 'system'),
      created_at: '2026-05-01T00:00:00.000Z',
    })
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_cost_001', {
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      shares: 100,
      cost_basis_per_share: 100,
      currency: 'USD',
      opened_at: '2026-05-01',
    }))
    // Latest valuation: 100 shares × $90 = $9,000 market value; sole holding → 100% NAV (>15%).
    await store.append(ledgerEvent('holding_valuation_recorded', 'holding', 'holding_cost_001', {
      snapshot_id: 'snap_cost_001',
      holding_id: 'holding_cost_001',
      price_per_share: 90,
      shares: 100,
      market_value: 9000,
      currency: 'USD',
      valued_at: '2026-06-09',
      valuation_source: 'mock-price-source',
      missing_data: [],
    }, 'worker'))
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-10T09:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'holdings_monitor',
      now: () => '2026-06-10T09:00:00.000Z',
      run_id: () => 'run_holdings_monitor_001',
      // $90 ≤ T2 trigger ($90 = 100 × (1 − 0.10)).
      priceSource: makeMockPriceSource({ COST: { available: true, price_per_share: 90, currency: 'USD', as_of: '2026-06-10T00:00:00.000Z', source: 'mock-price-source' } }),
    })

    const events = await store.list()
    const alert = events.find((event) => event.event_type === 'holding_monitor_alert_recorded')
    expect(alert?.payload).toMatchObject({
      ticker: 'COST',
      tranche_review_alert: true,
      triggered_tranches: ['T2'],
      trim_review_alert: true,
      is_observation: true,
      is_recommendation: false,
    })
    expect((alert?.payload as { thesis_gated_note?: string }).thesis_gated_note).toMatch(/thesis re-check FIRST/)
    expect((alert?.payload as { weight_pct?: number }).weight_pct).toBeCloseTo(100, 1)
    // No trade / no review confirmation auto-authored.
    expect(events.map((event) => event.event_type)).not.toContain('holding_realized_gain_loss_recorded')
  })

  it('starts a 90-day Shariah grace on a FAIL breach, then emits a DIVEST-REQUIRED draft once expired — never an execution', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_brk_001', {
      holding_id: 'holding_brk_001',
      watchlist_item_id: 'wl_brk_001',
      research_case_id: 'rc_brk_001',
      ticker: 'BRK',
      strategy_id: 'buffett-munger',
      shares: 10,
      cost_basis_per_share: 100,
      currency: 'USD',
      opened_at: '2026-01-01',
    }))

    // A FAIL ratio set: interest-bearing debt / market cap = 0.40 (> 0.30).
    const failRatios = { interest_bearing_debt: 400, cash_and_securities: 100, total_revenue: 1000, market_cap: 1000, impermissible_income: 0 }
    const shariahRatioSource = () => Promise.resolve(failRatios)

    // First quarterly tick → starts a grace period.
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_shariah_rescreen_quarterly', {
      scheduled_task_id: 'task_shariah_rescreen_quarterly',
      task_kind: 'shariah_rescreen',
      cadence: '0 6 1 */3 *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: 300_000 },
      safety: { mock_safe: true, auto_approve_investment_actions: false, auto_approve_portfolio_actions: false },
    }))

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'shariah_rescreen',
      now: () => '2026-03-01T06:00:00.000Z',
      run_id: () => 'run_shariah_rescreen_001',
      shariahRatioSource,
    })

    let events = await store.list()
    const grace = events.find((event) => event.event_type === 'holding_shariah_grace_started')
    expect(grace?.payload).toMatchObject({ holding_id: 'holding_brk_001', grace_days: 90, deadline: '2026-05-30', is_observation: true })
    expect(events.map((event) => event.event_type)).not.toContain('holding_sell_review_drafted')

    // Second tick, now PAST the deadline → DIVEST-REQUIRED draft.
    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'shariah_rescreen',
      now: () => '2026-06-10T06:00:00.000Z',
      run_id: () => 'run_shariah_rescreen_002',
      shariahRatioSource,
    })

    events = await store.list()
    const sellReview = events.find((event) => event.event_type === 'holding_sell_review_drafted')
    expect(sellReview?.payload).toMatchObject({
      holding_id: 'holding_brk_001',
      reason_code: 'unresolvable_shariah_breach',
      weakest_reason: 'valuation_inverted',
      is_execution: false,
      is_recommendation: false,
      requires_user_authoring: true,
    })
    expect(sellReview?.actor_type).toBe('worker')
    // No exit / realized-gain / state-advance was auto-authored.
    expect(events.map((event) => event.event_type)).not.toContain('holding_realized_gain_loss_recorded')
  })

  it('shariah_rescreen is fail-closed with no injected ratio source (no live fetch, no events)', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_cost_001', {
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      shares: 1,
      cost_basis_per_share: 100,
      currency: 'USD',
      opened_at: '2026-05-01',
    }))
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_shariah_rescreen_quarterly', {
      scheduled_task_id: 'task_shariah_rescreen_quarterly',
      task_kind: 'shariah_rescreen',
      cadence: '0 6 1 */3 *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: 300_000 },
      safety: { mock_safe: true, auto_approve_investment_actions: false, auto_approve_portfolio_actions: false },
    }))

    const result = await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'shariah_rescreen',
      now: () => '2026-06-10T06:00:00.000Z',
      run_id: () => 'run_shariah_rescreen_failclosed',
    })

    expect(result.summaries.join(' ')).toMatch(/no Shariah-ratio source injected/)
    const events = await store.list()
    expect(events.map((event) => event.event_type)).not.toContain('holding_shariah_grace_started')
    expect(events.map((event) => event.event_type)).not.toContain('holding_sell_review_drafted')
  })
})

// ---------------------------------------------------------------------------
// Task 3.2b — cadence-engine adapter equivalence + new cadence task kinds.
//
// These tests pin that the engine-routed handlers (watchlist_monitor, shariah_rescreen) emit the SAME
// events on the existing fixtures as before the refactor (the characterization baseline above is the
// "before"; these re-assert the byte-level payload + idempotency keys + gates that must not move), and
// that the engine is the decision source (decideForName agrees with the emitted alert_kind / path).
// holdings_monitor + holding_review_draft are NOT routed (see the report) and keep their own tests.
// ---------------------------------------------------------------------------
describe('worker runtime — cadence engine adapter equivalence (Task 3.2b)', () => {
  it('watchlist_monitor (engine-routed) emits the IDENTICAL buy_window alert payload + idempotency key', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await watchlistWithBuyPrice(store, { ticker: 'CPRT', buyPrice: 100, fairValue: 140, caseUpdatedAt: '2026-03-01T00:00:00.000Z' })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-10T09:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      now: () => '2026-06-10T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_bw_eq_001',
      priceSource: makeMockPriceSource({ CPRT: { available: true, price_per_share: 90, currency: 'USD', as_of: '2026-06-10T00:00:00.000Z', source: 'mock-price-source' } }),
    })

    const alert = (await store.list()).find((event) => event.event_type === 'watchlist_monitor_alert_recorded')
    expect(alert?.payload).toMatchObject({
      ticker: 'CPRT',
      alert_kind: 'buy_window',
      buy_window_alert: true,
      suppressed: false,
      rerun_needed: false,
      discount_to_buy_pct: 10,
      case_age_months: 3,
      is_observation: true,
      is_recommendation: false,
    })
    expect(alert?.idempotency_key).toBe('watchlist-monitor-alert:wmon_wl_cprt_001_20260610:mock-price-source')
    expect(alert?.actor_type).toBe('worker')
  })

  it('watchlist_monitor (engine-routed) still SUPPRESSES on a stale-but-cheap case (engine stale→suppress)', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await watchlistWithBuyPrice(store, { ticker: 'STALE', buyPrice: 100, fairValue: 140, caseUpdatedAt: '2024-12-01T00:00:00.000Z' })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-10T09:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      now: () => '2026-06-10T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_stale_eq_001',
      priceSource: makeMockPriceSource({ STALE: { available: true, price_per_share: 80, currency: 'USD', as_of: '2026-06-10T00:00:00.000Z', source: 'mock-price-source' } }),
    })

    const alert = (await store.list()).find((event) => event.event_type === 'watchlist_monitor_alert_recorded')
    expect(alert?.payload).toMatchObject({
      alert_kind: 'buy_window_suppressed',
      buy_window_alert: false,
      suppressed: true,
      rerun_needed: true,
    })
    expect((alert?.payload as { suppression_reason?: string }).suppression_reason).toMatch(/stale cheapness is not a signal/)
  })

  it('watchlist_monitor (engine-routed) SUPPRESSES a superseded-but-RECENT cheap gate-clean case (no contradictory buy_window fields)', async () => {
    // The watchlist-referenced case is RECENT (fresh by age) and gate-clean, the price is cheap — the ONLY
    // staleness cause is that a newer version SUPERSEDES it. Pre-route, evaluateWatchlistBuyWindow folded
    // superseded → stale → buy_window_suppressed/suppressed=true. The engine must match exactly, with NO
    // contradictory buy_window fields.
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await watchlistWithBuyPrice(store, { ticker: 'SUPS', buyPrice: 100, fairValue: 140, caseUpdatedAt: '2026-05-15T00:00:00.000Z', superseded: true })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-10T09:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'watchlist_monitor',
      now: () => '2026-06-10T09:00:00.000Z',
      run_id: () => 'run_watchlist_monitor_superseded_eq_001',
      priceSource: makeMockPriceSource({ SUPS: { available: true, price_per_share: 80, currency: 'USD', as_of: '2026-06-10T00:00:00.000Z', source: 'mock-price-source' } }),
    })

    const alert = (await store.list()).find((event) => event.event_type === 'watchlist_monitor_alert_recorded')
    expect(alert?.payload).toMatchObject({
      ticker: 'SUPS',
      alert_kind: 'buy_window_suppressed',
      buy_window_alert: false,
      suppressed: true,
      rerun_needed: true,
    })
    expect((alert?.payload as { suppression_reason?: string }).suppression_reason).toMatch(/superseded/)
    // No contradictory buy_window fields: it must NOT be a buy_window alert.
    expect((alert?.payload as { alert_kind?: string }).alert_kind).not.toBe('buy_window')
    expect((alert?.payload as { buy_window_alert?: boolean }).buy_window_alert).toBe(false)
    expect(alert?.actor_type).toBe('worker')
    expect((await store.list()).map((event) => event.event_type)).not.toContain('holding_opened')
  })

  it('decideForName is the decision source: watched + cheap + fresh + gate-clean → buy_eval (no suppress)', async () => {
    const { decideForName, watchlistRow } = await import('../lifecycleEngineAdapter')
    const decision = decideForName(
      watchlistRow({ ticker: 'CPRT', research_case_id: 'rc', case_updated_at: '2026-03-01T00:00:00.000Z', buy_price_per_share: 100, investment_verdict: 'WATCH', shariah_status: 'PASS' }),
      { now: new Date('2026-06-10T09:00:00.000Z'), current_price: 90 },
    )
    expect(decision.has('buy_eval')).toBe(true)
    expect(decision.has('suppress')).toBe(false)
  })

  it('decideForName: watched + cheap + stale → suppress (engine drops the buy)', async () => {
    const { decideForName, watchlistRow } = await import('../lifecycleEngineAdapter')
    const decision = decideForName(
      watchlistRow({ ticker: 'STALE', research_case_id: 'rc', case_updated_at: '2024-12-01T00:00:00.000Z', buy_price_per_share: 100, investment_verdict: 'WATCH', shariah_status: 'PASS' }),
      { now: new Date('2026-06-10T09:00:00.000Z'), current_price: 80 },
    )
    expect(decision.has('suppress')).toBe(true)
  })

  it('shariah_rescreen (engine-routed) emits the IDENTICAL grace then divest draft on a held FAIL breach', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_brk_001', {
      holding_id: 'holding_brk_001',
      watchlist_item_id: 'wl_brk_001',
      research_case_id: 'rc_brk_001',
      ticker: 'BRK',
      strategy_id: 'buffett-munger',
      shares: 10,
      cost_basis_per_share: 100,
      currency: 'USD',
      opened_at: '2026-01-01',
    }))
    const failRatios = { interest_bearing_debt: 400, cash_and_securities: 100, total_revenue: 1000, market_cap: 1000, impermissible_income: 0 }
    const shariahRatioSource = () => Promise.resolve(failRatios)
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_shariah_rescreen_quarterly', {
      scheduled_task_id: 'task_shariah_rescreen_quarterly',
      task_kind: 'shariah_rescreen',
      cadence: '0 6 1 */3 *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: 300_000 },
      safety: { mock_safe: true, auto_approve_investment_actions: false, auto_approve_portfolio_actions: false },
    }))

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'shariah_rescreen',
      now: () => '2026-03-01T06:00:00.000Z',
      run_id: () => 'run_shariah_rescreen_eq_001',
      shariahRatioSource,
    })
    let events = await store.list()
    const grace = events.find((event) => event.event_type === 'holding_shariah_grace_started')
    expect(grace?.payload).toMatchObject({ holding_id: 'holding_brk_001', grace_days: 90, deadline: '2026-05-30', is_observation: true })
    expect(grace?.idempotency_key).toBe('holding-shariah-grace:grace_holding_brk_001_20260301')

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'shariah_rescreen',
      now: () => '2026-06-10T06:00:00.000Z',
      run_id: () => 'run_shariah_rescreen_eq_002',
      shariahRatioSource,
    })
    events = await store.list()
    const sellReview = events.find((event) => event.event_type === 'holding_sell_review_drafted')
    expect(sellReview?.payload).toMatchObject({
      holding_id: 'holding_brk_001',
      reason_code: 'unresolvable_shariah_breach',
      weakest_reason: 'valuation_inverted',
      is_execution: false,
      is_recommendation: false,
      requires_user_authoring: true,
    })
    expect(sellReview?.idempotency_key).toBe('holding-sell-review:sellreview_holding_brk_001_20260610')
  })

  it('re_underwrite cadence pass emits a holding_monitor_alert_recorded re-underwrite observation on a >12mo held case', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append({
      ...ledgerEvent('buffett_munger_analysis_drafted', 'research_case', 'rc_aapl_001', {
        research_case_id: 'rc_aapl_001',
        ticker: 'AAPL',
        investment_verdict: 'WATCH',
        shariah_status: 'PASS',
        valuation: { moat_class: 'wide', buy_price_per_share: 100, fair_value_per_share: 140 },
      }, 'system'),
      created_at: '2024-12-01T00:00:00.000Z',
    })
    await store.append({
      ...ledgerEvent('holding_opened', 'holding', 'holding_aapl_001', {
        holding_id: 'holding_aapl_001',
        watchlist_item_id: 'wl_aapl_001',
        research_case_id: 'rc_aapl_001',
        ticker: 'AAPL',
        strategy_id: 'buffett-munger',
        shares: 10,
        cost_basis_per_share: 100,
        currency: 'USD',
        opened_at: '2024-12-01',
      }),
      created_at: '2024-12-01T00:00:00.000Z',
    })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-10T06:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 're_underwrite',
      now: () => '2026-06-10T06:00:00.000Z',
      run_id: () => 'run_re_underwrite_001',
    })

    const events = await store.list()
    const alert = events.find((event) => event.event_type === 'holding_monitor_alert_recorded')
    expect(alert?.payload).toMatchObject({
      holding_id: 'holding_aapl_001',
      ticker: 'AAPL',
      cadence_pass: 're_underwrite',
      alert_kind: 're_underwrite',
      is_observation: true,
      is_recommendation: false,
    })
    expect(alert?.idempotency_key).toBe('cadence-re_underwrite:cadence_re_underwrite_holding_aapl_001_re_underwrite_20260610')
    expect(alert?.actor_type).toBe('worker')
    // No auto-trade / state advance.
    expect(events.map((event) => event.event_type)).not.toContain('holding_realized_gain_loss_recorded')
  })

  it('falsifier_check cadence pass emits a watchlist_monitor_alert_recorded buy_window observation on a cheap fresh watched name', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await watchlistWithBuyPrice(store, { ticker: 'CPRT', buyPrice: 100, fairValue: 140, caseUpdatedAt: '2026-03-01T00:00:00.000Z' })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-10T06:00:00.000Z' })

    await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'falsifier_check',
      now: () => '2026-06-10T06:00:00.000Z',
      run_id: () => 'run_falsifier_check_001',
      priceSource: makeMockPriceSource({ CPRT: { available: true, price_per_share: 90, currency: 'USD', as_of: '2026-06-10T00:00:00.000Z', source: 'mock-price-source' } }),
    })

    const events = await store.list()
    const alert = events.find(
      (event) => event.event_type === 'watchlist_monitor_alert_recorded'
        && (event.payload as { cadence_pass?: string }).cadence_pass === 'falsifier_check',
    )
    expect(alert?.payload).toMatchObject({
      ticker: 'CPRT',
      cadence_pass: 'falsifier_check',
      alert_kind: 'buy_eval',
      buy_window_alert: true,
      is_observation: true,
      is_recommendation: false,
    })
    expect(alert?.idempotency_key).toBe('cadence-falsifier_check:cadence_falsifier_check_wl_cprt_001_buy_eval_20260610')
    // Never opens a holding.
    expect(events.map((event) => event.event_type)).not.toContain('holding_opened')
  })
})
