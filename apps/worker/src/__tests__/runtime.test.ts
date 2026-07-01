import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectPurificationLedger } from '@owlfolio/ledger/projections/purificationProjection'
import { projectScheduledTasks } from '@owlfolio/ledger/projections/scheduledTaskProjection'
import { projectPendingResearchRuns } from '@owlfolio/ledger/projections/researchRunQueueProjection'
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

/**
 * Provider whose structured() always returns thesis_health: 'IMPAIRED' for holding reviews.
 * All other structured outputs delegate to MockProvider.
 */
class ImpairedReviewProvider implements Provider {
  readonly provider_id = 'mock-provider'
  readonly capabilities = new MockProvider().capabilities

  private readonly delegate = new MockProvider()

  complete(request: ProviderRunRequest) {
    return this.delegate.complete(request)
  }

  async structured<T>(request: ProviderRunRequest, schema: Parameters<Provider['structured']>[1]): Promise<T> {
    const result = await (this.delegate.structured(request, schema) as Promise<T>)
    // Detect holding review requests by schema name and override thesis_health.
    if (request.response_format?.kind === 'json-schema' && request.response_format.schema_name === 'BuffettMungerHoldingReview') {
      return { ...(result as object), thesis_health: 'IMPAIRED', action_stance: 'REDUCE' } as T
    }
    return result
  }

  runWithTools(request: ProviderRunRequest): Promise<ProviderToolRun> {
    return this.delegate.runWithTools(request)
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
    expect(definitions).toHaveLength(11)
    expect(definitions.map((event) => event.payload)).toEqual([
      expect.objectContaining({ task_kind: 'review_reminder', dry_run: true, enabled: true }),
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
        task_kind: 'holding_review_draft',
        dry_run: true,
        enabled: true,
        timeout_ms: 120_000,
        max_cost_usd: 0.25,
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
        task_kind: 'purification_projection',
        cadence: '0 6 1 */3 *',
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

  it('skips the quarterly purification projection when the scheduled tick is not due', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_purification_projection_quarterly', {
      scheduled_task_id: 'task_purification_projection_quarterly',
      task_kind: 'purification_projection',
      cadence: '0 6 1 */3 *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: 300_000 },
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    }))

    const result = await runScheduledTasks(store, {
      as_of: '2026-06-15',
      dry_run: true,
      now: () => '2026-06-15T06:00:00.000Z',
    })

    expect(result).toMatchObject({ considered: 1, completed: 0, failed: 0, skipped: 1, events_appended: 0 })
    expect(result.summaries).toEqual([
      'task_purification_projection_quarterly skipped: not due until quarterly cadence 0 6 1 */3 *',
    ])
  })

  it('runs the quarterly purification projection when the scheduled worker tick is delayed within the due quarter', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('scheduled_task_defined', 'scheduled_task', 'task_purification_projection_quarterly', {
      scheduled_task_id: 'task_purification_projection_quarterly',
      task_kind: 'purification_projection',
      cadence: '0 6 1 */3 *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: 300_000 },
    }))

    const result = await runScheduledTasks(store, {
      dry_run: true,
      now: () => '2026-07-01T06:01:00.000Z',
      run_id: () => 'run_purification_projection_delayed_tick',
    })

    expect(result).toMatchObject({ considered: 1, completed: 1, failed: 0, skipped: 0, events_appended: 2 })
    expect(result.summaries).toEqual([
      'purification_projection dry-run: calculated 0 estimated purification obligation(s), 0 pending dividend(s) need evidence, 0 exit finalization(s); quarterly statement + no zakat statement; no payment or resolution marked',
    ])
  })

  it('refreshes portfolio valuations via injected price source (yahoo) without approving actions', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_unknown_001', {
      holding_id: 'holding_unknown_001',
      watchlist_item_id: 'wl_unknown_001',
      research_case_id: 'rc_unknown_001',
      ticker: 'ZZZZ',
      strategy_id: 'buffett-munger',
      shares: 2,
      cost_basis_per_share: 50,
      currency: 'USD',
      opened_at: '2026-05-30',
    }))
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T07:00:00.000Z' })

    const priceSource = makeMockPriceSource({
      COST: { available: true, price_per_share: 912.34, currency: 'USD', as_of: '2026-06-01', source: 'yahoo' },
      // ZZZZ is not in the map → unavailable
    })

    const result = await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'portfolio_valuation_refresh',
      now: () => '2026-06-01T07:00:00.000Z',
      run_id: () => 'run_portfolio_valuation_refresh_001',
      priceSource,
    })

    expect(result).toMatchObject({ completed: 1, failed: 0 })
    const events = await store.list()
    const valuation = events.find((event) => event.event_type === 'holding_valuation_recorded')
    expect(valuation).toMatchObject({
      aggregate_type: 'holding',
      aggregate_id: 'holding_cost_001',
      actor_type: 'worker',
      actor_id: 'owlfolio-worker',
      causation_id: 'evt_scheduled_task_run_started_run_portfolio_valuation_refresh_001',
      payload: expect.objectContaining({
        snapshot_id: 'scheduled_holding_cost_001_20260601',
        holding_id: 'holding_cost_001',
        price_per_share: 912.34,
        market_value: 912.34,
        valuation_source: 'yahoo',
        price_checked_at: '2026-06-01',
        confidence: 'market',
        caveat: 'Live market price from Yahoo Finance',
        valued_by_actor_type: 'worker',
        valued_by_actor_id: 'owlfolio-worker',
      }),
      source_ids: ['yahoo:COST:2026-06-01'],
    })
    expect(projectHoldings(events).find((holding) => holding.holding_id === 'holding_cost_001')).toMatchObject({
      latest_valuation_source: 'yahoo',
      latest_price_checked_at: '2026-06-01',
      latest_valuation_confidence: 'market',
      latest_valuation_source_ids: ['yahoo:COST:2026-06-01'],
    })
    const completed = events.find((event) => event.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      result_summary: 'portfolio_valuation_refresh dry-run: refreshed 1 holding valuation(s), 1 holding(s) missing price data; no investment decision or portfolio action taken',
      observations: [
        'COST valuation refreshed from yahoo at $912.34; factual valuation update only',
        'ZZZZ: no auto price (manual valuation required) — no mock price',
      ],
      approval_gates: [],
      human_approval_required: false,
      auto_approved_actions: 0,
      missing_data_holding_ids: ['holding_unknown_001'],
    })
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'holding_opened', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'holding_review_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'watchlist_draft_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'purification_payment_recorded', actor_type: 'worker' }),
    ]))
  })

  it('does not count same-day idempotent valuation refresh reruns as new snapshot events', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T07:00:00.000Z' })

    const priceSource = makeMockPriceSource({
      COST: { available: true, price_per_share: 912.34, currency: 'USD', as_of: '2026-06-01', source: 'yahoo' },
    })

    await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'portfolio_valuation_refresh',
      now: () => '2026-06-01T07:00:00.000Z',
      run_id: () => 'run_portfolio_valuation_refresh_001',
      priceSource,
    })
    const rerun = await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'portfolio_valuation_refresh',
      now: () => '2026-06-01T08:00:00.000Z',
      run_id: () => 'run_portfolio_valuation_refresh_002',
      priceSource,
    })

    const events = await store.list()
    expect(events.filter((event) => event.event_type === 'holding_valuation_recorded')).toHaveLength(1)
    expect(rerun).toMatchObject({ completed: 1, failed: 0, events_appended: 2 })
    expect(rerun.summaries).toEqual([
      'portfolio_valuation_refresh dry-run: refreshed 0 holding valuation(s), 0 holding(s) missing price data; no investment decision or portfolio action taken',
    ])
    expect(events.find((event) => event.event_id === 'evt_scheduled_task_run_completed_run_portfolio_valuation_refresh_002')?.payload).toMatchObject({
      observations: ['COST valuation already refreshed from yahoo for 2026-06-01; no duplicate valuation event appended'],
    })
  })

  it('projects AAOIFI-aware purification obligations from dividend and Shariah evidence without marking payments resolved', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_cost_001', {
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      company_id: 'company_cost',
      company_name: 'Costco Wholesale Corporation',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      shares: 1,
      cost_basis_per_share: 812.4,
      currency: 'USD',
      opened_at: '2026-05-28',
    }))
    await store.append({
      ...ledgerEvent('dividend_income_recorded', 'cash_account', 'cash_usd', {
        dividend_id: 'div_cost_2026_06',
        holding_id: 'holding_cost_001',
        cash_account_id: 'cash_usd',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
        taxable_status: 'unclassified',
      }),
      source_ids: ['broker_dividend_notice_cost_2026_06'],
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    await store.append({
      ...ledgerEvent('shariah_evaluation_recorded', 'holding', 'holding_cost_001', {
        evaluation_id: 'shariah_cost_q2',
        holding_id: 'holding_cost_001',
        status: 'CONDITIONAL',
        policy_basis: 'AAOIFI',
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        standard_reference: 'AAOIFI SS 21 (secondary-source mapped)',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        source_filing_type: '10-Q',
        source_filing_date: '2026-04-25',
        evidence_summary: 'Mock provider ratio from company filing.',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
        source_ids: ['src_cost_10q', 'src_cost_shariah_screen'],
      }, 'provider'),
      source_ids: ['src_cost_10q', 'src_cost_shariah_screen'],
      created_at: '2026-06-14T12:00:00.000Z',
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    await defineDefaultScheduledTasks(store, { now: () => '2026-07-01T06:00:00.000Z' })

    const result = await runScheduledTasks(store, {
      dry_run: true,
      task_kind: 'purification_projection',
      now: () => '2026-07-01T06:00:00.000Z',
      run_id: () => 'run_purification_projection_001',
    })

    expect(result).toMatchObject({ completed: 1, failed: 0 })
    const events = await store.list()
    const obligation = events.find((event) => event.event_type === 'purification_obligation_recorded')
    expect(obligation).toMatchObject({
      aggregate_type: 'purification_entry',
      aggregate_id: expect.stringMatching(/^purify_calc_holding_cost_001_div_cost_2026_06_AAOIFI_SS21_APP_POLICY_2026_06_[a-z0-9]+$/),
      actor_type: 'worker',
      actor_id: 'owlfolio-worker',
      causation_id: 'evt_scheduled_task_run_started_run_purification_projection_001',
      correlation_id: 'run_purification_projection_001',
      idempotency_key: expect.stringMatching(/^purification-obligation:calc_holding_cost_001_div_cost_2026_06_AAOIFI_SS21_APP_POLICY_2026_06_[a-z0-9]+$/),
      payload: expect.objectContaining({
        calculation_id: expect.stringMatching(/^calc_holding_cost_001_div_cost_2026_06_AAOIFI_SS21_APP_POLICY_2026_06_[a-z0-9]+$/),
        holding_id: 'holding_cost_001',
        company_id: 'company_cost',
        ticker: 'COST',
        company_name: 'Costco Wholesale Corporation',
        period_start: '2026-06-15',
        period_end: '2026-06-15',
        policy_basis: 'AAOIFI',
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        dividend_income_amount: 40,
        non_compliant_income_ratio: 0.05,
        purification_ratio: 0.05,
        holding_period_basis: 'dividend_received_during_open_holding_period',
        amount: 2,
        purification_amount: 2,
        calculated_at: '2026-07-01T06:00:00.000Z',
        next_calculation_at: '2026-10-01T06:00:00.000Z',
        requires_user_confirmation: true,
        requires_scholar_review: true,
      }),
    })
    expect(projectPurificationLedger(events).summary_by_currency).toEqual({
      USD: { owed: 2, paid: 0, remaining: 2 },
    })
    const completed = events.find((event) => event.event_id === 'evt_scheduled_task_run_completed_run_purification_projection_001')
    expect(completed?.payload).toMatchObject({
      result_summary: 'purification_projection dry-run: calculated 1 estimated purification obligation(s), 0 pending dividend(s) need evidence, 0 exit finalization(s); quarterly statement + no zakat statement; no payment or resolution marked',
      approval_gates: ['purification_payment_requires_user_confirmation'],
      human_approval_required: true,
      auto_approved_actions: 0,
    })
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'purification_payment_recorded', actor_type: 'worker' }),
    ]))
  })

  it('does not duplicate purification obligations on idempotent scheduler reruns', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append(ledgerEvent('holding_opened', 'holding', 'holding_cost_001', {
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      company_id: 'company_cost',
      company_name: 'Costco Wholesale Corporation',
      ticker: 'COST',
      shares: 1,
      cost_basis_per_share: 812.4,
      currency: 'USD',
      opened_at: '2026-05-28',
    }))
    await store.append({
      ...ledgerEvent('dividend_income_recorded', 'cash_account', 'cash_usd', {
        dividend_id: 'div_cost_2026_06',
        holding_id: 'holding_cost_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      }),
      source_ids: ['broker_dividend_notice_cost_2026_06'],
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    await store.append({
      ...ledgerEvent('shariah_evaluation_recorded', 'holding', 'holding_cost_001', {
        evaluation_id: 'shariah_cost_q2',
        holding_id: 'holding_cost_001',
        status: 'CONDITIONAL',
        policy_basis: 'AAOIFI',
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        standard_reference: 'AAOIFI SS 21 (secondary-source mapped)',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
        source_ids: ['src_cost_10q'],
      }, 'provider'),
      source_ids: ['src_cost_10q'],
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    await defineDefaultScheduledTasks(store, { now: () => '2026-07-01T06:00:00.000Z' })

    await runScheduledTasks(store, {
      as_of: '2026-06-30',
      dry_run: true,
      task_kind: 'purification_projection',
      now: () => '2026-07-01T06:00:00.000Z',
      run_id: () => 'run_purification_projection_001',
    })
    const rerun = await runScheduledTasks(store, {
      as_of: '2026-06-30',
      dry_run: true,
      task_kind: 'purification_projection',
      now: () => '2026-07-01T07:00:00.000Z',
      run_id: () => 'run_purification_projection_002',
    })

    const events = await store.list()
    expect(events.filter((event) => event.event_type === 'purification_obligation_recorded')).toHaveLength(1)
    expect(rerun).toMatchObject({ completed: 1, failed: 0, events_appended: 2 })
    expect(events.find((event) => event.event_id === 'evt_scheduled_task_run_completed_run_purification_projection_002')?.payload).toMatchObject({
      observations: [
        expect.stringMatching(/^holding_cost_001 purification calculation calc_holding_cost_001_div_cost_2026_06_AAOIFI_SS21_APP_POLICY_2026_06_[a-z0-9]+ already projected; no duplicate obligation appended$/),
        expect.stringMatching(/^purification statement 2026-04-01\.\.2026-06-30 \(USD\): accrued this period [0-9.]+, cumulative unpaid [0-9.]+ across 1 holding\(s\); human authors any disbursement$/),
      ],
      approval_gates: [],
      human_approval_required: false,
    })
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

  it('appends holding_valuation_recorded with valuation_source yahoo when injected price source returns available', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-02T07:00:00.000Z' })

    const priceSource = makeMockPriceSource({
      COST: { available: true, price_per_share: 905.00, currency: 'USD', as_of: '2026-06-02', source: 'yahoo' },
    })

    const result = await runScheduledTasks(store, {
      as_of: '2026-06-02',
      dry_run: true,
      task_kind: 'portfolio_valuation_refresh',
      now: () => '2026-06-02T07:00:00.000Z',
      run_id: () => 'run_portfolio_valuation_yahoo_001',
      priceSource,
    })

    expect(result).toMatchObject({ completed: 1, failed: 0 })
    const events = await store.list()
    const valuation = events.find((event) => event.event_type === 'holding_valuation_recorded')
    expect(valuation).toBeDefined()
    expect(valuation?.payload).toMatchObject({
      holding_id: 'holding_cost_001',
      price_per_share: 905.00,
      market_value: 905.00,
      valuation_source: 'yahoo',
      confidence: 'market',
      caveat: 'Live market price from Yahoo Finance',
      valued_by_actor_type: 'worker',
      valued_by_actor_id: 'owlfolio-worker',
    })
    expect(valuation?.source_ids).toEqual(['yahoo:COST:2026-06-02'])
    const completed = events.find((event) => event.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      result_summary: expect.stringContaining('refreshed 1 holding valuation(s)'),
      approval_gates: [],
      human_approval_required: false,
      auto_approved_actions: 0,
    })
  })

  it('skips holding_valuation_recorded and notes manual required when injected price source returns unavailable', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-02T07:00:00.000Z' })

    // Price source returns unavailable for all tickers (simulates uncovered exchange / network error)
    const priceSource = makeMockPriceSource({})

    const result = await runScheduledTasks(store, {
      as_of: '2026-06-02',
      dry_run: true,
      task_kind: 'portfolio_valuation_refresh',
      now: () => '2026-06-02T07:00:00.000Z',
      run_id: () => 'run_portfolio_valuation_unavailable_001',
      priceSource,
    })

    expect(result).toMatchObject({ completed: 1, failed: 0 })
    const events = await store.list()
    // No holding_valuation_recorded events appended
    expect(events.filter((event) => event.event_type === 'holding_valuation_recorded')).toHaveLength(0)
    const completed = events.find((event) => event.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      result_summary: 'portfolio_valuation_refresh dry-run: refreshed 0 holding valuation(s), 1 holding(s) missing price data; no investment decision or portfolio action taken',
      missing_data_holding_ids: ['holding_cost_001'],
      approval_gates: [],
      human_approval_required: false,
    })
    // Observation must mention manual valuation required
    const observations = (completed?.payload as Record<string, unknown>)?.observations
    expect(Array.isArray(observations)).toBe(true)
    expect((observations as string[]).some((obs) => obs.includes('manual valuation required'))).toBe(true)
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

  it('automation settings: disabling thesis_review sets holding_review_draft and review_reminder tasks enabled=false', async () => {
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
    const reviewDraftTask = tasks.find((t) => t.task_kind === 'holding_review_draft')
    const reviewReminderTask = tasks.find((t) => t.task_kind === 'review_reminder')
    expect(reviewDraftTask?.enabled).toBe(false)
    expect(reviewReminderTask?.enabled).toBe(false)
  })

  it('automation settings: disabling purification sets purification_projection task enabled=false', async () => {
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
    const purificationTask = tasks.find((t) => t.task_kind === 'purification_projection')
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

  // --- Escalation: thesis-impaired review → enqueue full reanalysis ---

  it('thesis IMPAIRED + research_engine ON → appends research_run_requested (versioned, supersedes prior, causation linked)', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    // Seed a prior research case for COST so the escalation creates a versioned superseding run
    await store.append(ledgerEvent('research_run_requested', 'research_case', 'rc_cost_001', {
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      company_id: 'company_cost',
      strategy_id: 'buffett-munger',
      decision_id: 'decision_cost_001',
      version: 1,
      requested_by: 'user_local',
    }))
    // Mark the prior case as claimed so projectPendingResearchRuns returns empty
    await store.append(ledgerEvent('research_run_claimed', 'research_case', 'rc_cost_001', {
      research_case_id: 'rc_cost_001',
      run_id: 'run_rc_cost_001',
      claimed_at: '2026-06-01T08:00:00.000Z',
      worker_id: 'owlfolio-worker',
    }, 'worker'))
    // Mark case as having a quick_screen_drafted so the projection picks up ticker
    await store.append(ledgerEvent('quick_screen_drafted', 'research_case', 'rc_cost_001', {
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      company_id: 'company_cost',
      strategy_id: 'buffett-munger',
      screening_result: 'deep_dive_candidate',
      version: 1,
    }))
    await appendCostHolding(store)
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T10:00:00.000Z' })

    const result = await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'holding_review_draft',
      provider: new ImpairedReviewProvider(),
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
      run_id: () => 'run_holding_review_draft_escalation_001',
      automation: { ...defaultAutomationSettings(), research_engine_enabled: true },
    })

    expect(result).toMatchObject({ completed: 1, failed: 0 })
    const events = await store.list()

    // The holding_review_drafted event must exist
    const reviewDrafted = events.find((e) => e.event_type === 'holding_review_drafted')
    expect(reviewDrafted).toBeDefined()
    expect(reviewDrafted?.payload).toMatchObject({ thesis_health: 'IMPAIRED' })

    // A research_run_requested must have been appended for the escalation
    const allRequested = events.filter((e) => e.event_type === 'research_run_requested')
    // The new one (not the seeded rc_cost_001)
    const escalationRequested = allRequested.find((e) => e.aggregate_id !== 'rc_cost_001')
    expect(escalationRequested).toBeDefined()
    expect(escalationRequested?.payload).toMatchObject({
      ticker: 'COST',
      version: 2,
      supersedes_research_case_id: 'rc_cost_001',
      escalation_trigger: 'thesis_impaired_holding_review',
      escalation_thesis_health: 'IMPAIRED',
      escalation_holding_review_event_id: reviewDrafted?.event_id,
      escalation_holding_id: 'holding_cost_001',
    })
    // Causation must link the escalation to the holding_review_drafted event
    expect(escalationRequested?.causation_id).toBe(reviewDrafted?.event_id)
    expect(escalationRequested?.actor_type).toBe('worker')

    // The pending queue now holds the new escalation run (no duplicate)
    const pending = projectPendingResearchRuns(events as LedgerEventEnvelope<Record<string, unknown>>[])
    expect(pending).toHaveLength(1)
    expect(pending[0]?.ticker).toBe('COST')

    // The escalation observation must appear in the task completed payload
    const completed = events.find((e) => e.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      observations: expect.arrayContaining([
        expect.stringMatching(/COST.*thesis IMPAIRED.*escalated.*reanalysis/i),
      ]),
    })

    // Safety: no auto-confirmed actions
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'holding_review_confirmed', actor_type: 'worker' }),
      expect.objectContaining({ event_type: 'research_run_claimed', actor_type: 'worker', aggregate_id: escalationRequested?.aggregate_id }),
    ]))
  })

  it('thesis HEALTHY → NO research_run_requested enqueued', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T10:00:00.000Z' })

    await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'holding_review_draft',
      provider: new MockProvider(), // MockProvider always returns HEALTHY
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
      run_id: () => 'run_holding_review_draft_healthy_001',
      automation: { ...defaultAutomationSettings(), research_engine_enabled: true },
    })

    const events = await store.list()
    const reviewDrafted = events.find((e) => e.event_type === 'holding_review_drafted')
    expect(reviewDrafted?.payload).toMatchObject({ thesis_health: 'HEALTHY' })
    // No research_run_requested should have been appended
    expect(events.filter((e) => e.event_type === 'research_run_requested')).toHaveLength(0)
    const pending = projectPendingResearchRuns(events as LedgerEventEnvelope<Record<string, unknown>>[])
    expect(pending).toHaveLength(0)
  })

  it('thesis IMPAIRED + research_engine_enabled=false → NO escalation, master-switch observation recorded', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await appendCostHolding(store)
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T10:00:00.000Z' })

    await runScheduledTasks(store, {
      as_of: '2026-06-01',
      dry_run: true,
      task_kind: 'holding_review_draft',
      provider: new ImpairedReviewProvider(),
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
      run_id: () => 'run_holding_review_draft_engine_off_001',
      automation: { ...defaultAutomationSettings(), research_engine_enabled: false },
    })

    const events = await store.list()
    const reviewDrafted = events.find((e) => e.event_type === 'holding_review_drafted')
    expect(reviewDrafted?.payload).toMatchObject({ thesis_health: 'IMPAIRED' })
    // No research_run_requested should have been appended
    expect(events.filter((e) => e.event_type === 'research_run_requested')).toHaveLength(0)
    // The master-switch observation must appear
    const completed = events.find((e) => e.event_type === 'scheduled_task_run_completed')
    expect(completed?.payload).toMatchObject({
      observations: expect.arrayContaining([
        expect.stringMatching(/COST.*IMPAIRED.*research_engine_enabled=false/i),
      ]),
    })
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
