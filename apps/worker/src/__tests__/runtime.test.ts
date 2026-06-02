import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectScheduledTasks } from '@owlfolio/ledger/projections/scheduledTaskProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { CertificationReport } from '@owlfolio/providers'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { describe, expect, it, vi } from 'vitest'

import { main } from '../index'
import { defineDefaultScheduledTasks, resolveWorkerRuntimePaths, runScheduledTasks } from '../runtime'

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
    run_status: 'completed',
    support_level: 'unsupported',
    generated_at: '2026-06-01T00:00:00.000Z',
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'unsupported',
      'multi-step-tool-loop': 'unsupported',
    },
    cases: [],
    summary: 'Provider certification completed but is unsupported for execution.',
  }
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

  it('defines safe default dry-run tasks idempotently', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()

    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T08:00:00.000Z' })
    await defineDefaultScheduledTasks(store, { now: () => '2026-06-01T08:00:00.000Z' })

    const definitions = (await store.list()).filter((event) => event.event_type === 'scheduled_task_defined')
    expect(definitions).toHaveLength(2)
    expect(definitions.map((event) => event.payload)).toEqual([
      expect.objectContaining({ task_kind: 'review_reminder', dry_run: true, enabled: true }),
      expect.objectContaining({ task_kind: 'watchlist_monitor', dry_run: true, enabled: true }),
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
