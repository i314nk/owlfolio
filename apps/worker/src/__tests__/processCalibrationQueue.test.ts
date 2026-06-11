import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { Fundamentals, AnnualFacts } from '@owlfolio/workflow/secEdgar'
import type { PriceHistoryResult } from '@owlfolio/workflow/marketData'
import type { CalibrationUniverse } from '@owlfolio/workflow/calibrationUniverse'

import { runProcessCalibrationQueueTask } from '../runtime'

function annual(fy: number, filed: string): AnnualFacts {
  return { fiscal_year: fy, currency: 'USD', filed, period_end: `${fy}-12-31`, net_income_musd: 120, d_and_a_musd: 40, capex_musd: 30, sbc_musd: 20, diluted_shares_m: 100 }
}

function fundamentals(name: string): Fundamentals {
  return {
    cik: '', entity_name: name, currency: 'USD',
    latest_annual: annual(2015, '2016-02-15'),
    annual_series: [annual(2013, '2014-02-15'), annual(2014, '2015-02-15'), annual(2015, '2016-02-15')],
    filings: [{ form: '10-K', filed: '2016-02-15', url: 'https://example.com' }],
  }
}

function priceResult(): PriceHistoryResult {
  const points = []
  for (let m = 1; m <= 12; m += 1) points.push({ date: `2017-${String(m).padStart(2, '0')}-28`, close: 5 })
  return { available: true, currency: 'USD', points }
}

const universe: CalibrationUniverse = {
  version: 'calibration-universe-test-1',
  names: [
    { ticker: 'CPRT', company: 'Copart', market: 'US', fundamentals_hint: 'edgar' },
    { ticker: 'GHOST', company: 'Unresolvable', market: 'intl', fundamentals_hint: 'local_manual' },
  ],
}

describe('runProcessCalibrationQueueTask', () => {
  it('claims a pending request, runs the deterministic backtest, and records a calibration_run with coverage', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append({
      event_id: 'evt_cal_req_1', event_type: 'calibration_run_requested', aggregate_type: 'strategy',
      aggregate_id: 'buffett-munger', correlation_id: 'cal_1', actor_type: 'user', actor_id: 'user_local',
      payload: { calibration_run_id: 'cal_1', strategy_id: 'buffett-munger', universe_version: universe.version, requested_by: 'user_local' },
      source_ids: [], created_at: '2026-06-01T00:00:00Z', schema_version: 1,
    } as never)

    const result = await runProcessCalibrationQueueTask(store, {
      loadUniverse: () => universe,
      backtestDeps: {
        localProvider: { resolve: async () => undefined },
        edgarProvider: { resolve: async (t) => (t.toUpperCase() === 'CPRT' ? fundamentals('Copart') : undefined) },
        priceFetcher: async () => priceResult(),
      },
      now: () => new Date('2026-06-01T01:00:00Z'),
    })

    expect(result.processed).toBe(1)
    const events = await store.list()
    const run = events.find((e) => e.event_type === 'calibration_run')
    expect(run).toBeDefined()
    const payload = run!.payload as Record<string, unknown>
    expect(payload['universe_version']).toBe(universe.version)
    // The recorded universe carries ALL names (incl. unresolved), for reproducibility.
    expect(payload['universe']).toEqual(['CPRT', 'GHOST'])
    const coverage = payload['coverage'] as Array<{ ticker: string; status: string }>
    expect(coverage.find((c) => c.ticker === 'CPRT')?.status).toBe('resolved_edgar')
    expect(coverage.find((c) => c.ticker === 'GHOST')?.status).toBe('unresolved')
    // Observation-only: no valuation_config (param change) event is written.
    expect(events.some((e) => e.event_type === 'valuation_config')).toBe(false)
  })

  it('does not re-run a request that already recorded a calibration_run', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await store.append({
      event_id: 'evt_cal_req_1', event_type: 'calibration_run_requested', aggregate_type: 'strategy',
      aggregate_id: 'buffett-munger', correlation_id: 'cal_1', actor_type: 'user', actor_id: 'user_local',
      payload: { calibration_run_id: 'cal_1', strategy_id: 'buffett-munger', universe_version: universe.version },
      source_ids: [], created_at: '2026-06-01T00:00:00Z', schema_version: 1,
    } as never)
    await store.append({
      event_id: 'evt_cal_run_1', event_type: 'calibration_run', aggregate_type: 'strategy',
      aggregate_id: 'buffett-munger', correlation_id: 'cal_1', actor_type: 'worker', actor_id: 'owlfolio-worker',
      payload: { calibration_run_id: 'cal_1', params_version: 'v', universe: [], summaries: [], target: {} },
      source_ids: [], created_at: '2026-06-01T01:00:00Z', schema_version: 1,
    } as never)

    const result = await runProcessCalibrationQueueTask(store, {
      loadUniverse: () => universe,
      backtestDeps: { localProvider: { resolve: async () => undefined }, edgarProvider: { resolve: async () => undefined }, priceFetcher: async () => priceResult() },
    })
    expect(result.processed).toBe(0)
  })
})
