import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import {
  projectAccountingSnapshot,
  type AccountingCashFlow,
} from '@owlfolio/ledger/projections/accountingProjection'
import {
  computePerformance,
  type PerformanceBenchmarkPoint,
  type PerformanceResult,
} from '@owlfolio/workflow/performanceProjection'

import { monthPeriodFor } from './accounting'

/** Default Shariah-compliant benchmark: SP Funds S&P 500 Sharia ETF. */
export const DEFAULT_BENCHMARK_SYMBOL = 'SPUS'

export type AppPerformanceReport = {
  performance: PerformanceResult
  benchmark_symbol: string
  benchmark_label: string
  /** True when the page intentionally skipped the live benchmark fetch. */
  benchmark_pending: boolean
  /** Number of monthly NAV snapshots that fed the computation. */
  snapshot_count: number
  limitations: string[]
}

export type PerformanceClock = {
  now?: Date
  currency?: string
}

const accountingEventTypes = new Set([
  'holding_opened',
  'holding_valuation_recorded',
  'holding_realized_gain_loss_recorded',
  'cash_deposited',
  'cash_withdrawn',
  'dividend_income_recorded',
  'fee_charged',
])

const limitations = [
  'Time-weighted return is derived from monthly NAV valuation snapshots in the local ledger, adjusting for deposits, withdrawals, dividends, and fees between snapshots.',
  'Benchmark is SP Funds S&P 500 Sharia (SPUS), a halal S&P 500 proxy; returns are price-only from a keyless public feed and may differ from total-return indices.',
  'Local accounting aid, not a broker statement. Sparse valuation data yields sparse or unavailable returns.',
]

function eventCurrency(event: LedgerEventEnvelope<unknown>): string | undefined {
  const payload = event.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }
  const value = (payload as Record<string, unknown>).currency
  return typeof value === 'string' ? value : undefined
}

function eventDate(event: LedgerEventEnvelope<unknown>): string {
  const payload = event.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return event.created_at.slice(0, 10)
  }
  const record = payload as Record<string, unknown>
  const dateKeyByType: Record<string, string> = {
    cash_deposited: 'deposited_at',
    cash_withdrawn: 'withdrawn_at',
    dividend_income_recorded: 'received_at',
    fee_charged: 'charged_at',
    holding_opened: 'opened_at',
    holding_realized_gain_loss_recorded: 'realized_at',
    holding_valuation_recorded: 'valued_at',
  }
  const dateKey = dateKeyByType[event.event_type]
  const value = dateKey === undefined ? undefined : record[dateKey]
  return typeof value === 'string' && value.length > 0 ? value : event.created_at.slice(0, 10)
}

/**
 * Build the set of month-end periods spanned by the ledger's accounting events,
 * from the earliest event month through the current month (inclusive).
 */
function monthlyPeriods(events: LedgerEventEnvelope<unknown>[], now: Date, currency: string): ReturnType<typeof monthPeriodFor>[] {
  const relevant = events.filter((event) => accountingEventTypes.has(event.event_type) && eventCurrency(event) === currency)
  if (relevant.length === 0) {
    return []
  }
  const earliest = relevant
    .map((event) => eventDate(event))
    .sort((left, right) => left.localeCompare(right))[0]
  if (earliest === undefined) {
    return []
  }

  const start = new Date(`${earliest}T00:00:00.000Z`)
  const periods: ReturnType<typeof monthPeriodFor>[] = []
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  // Guard against runaway loops on bad data.
  let guard = 0
  while (cursor <= end && guard < 600) {
    periods.push(monthPeriodFor(cursor))
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
    guard += 1
  }
  return periods
}

export function buildPerformanceReport(
  events: LedgerEventEnvelope<unknown>[],
  benchmarkSeries: PerformanceBenchmarkPoint[] | undefined,
  { now = new Date(), currency = 'USD' }: PerformanceClock = {},
): AppPerformanceReport {
  const periods = monthlyPeriods(events, now, currency)

  // One NAV snapshot per month-end; keep only months whose snapshot has holdings
  // valued (a meaningful NAV) so sparse data does not fabricate flat sub-periods.
  const snapshots = periods
    .map((period) => projectAccountingSnapshot(events, {
      snapshot_id: `perf_${period.year}_${period.month}`,
      period_start: period.period_start,
      period_end: period.period_end,
      currency,
      recorded_at: now.toISOString(),
    }))
    .filter((snapshot) => snapshot.holdings.length > 0)
    .map((snapshot) => ({ period_end: snapshot.period_end, nav: snapshot.nav }))

  // All external cash flows across the full window (latest snapshot carries the
  // cumulative as-of cash-flow set when projected over the final period).
  const finalPeriod = periods[periods.length - 1]
  const allCashFlows: AccountingCashFlow[] = finalPeriod === undefined
    ? []
    : projectAccountingSnapshot(events, {
        snapshot_id: 'perf_flows',
        period_start: periods[0]?.period_start ?? finalPeriod.period_start,
        period_end: finalPeriod.period_end,
        currency,
        recorded_at: now.toISOString(),
      }).cash_flows

  const performance = computePerformance({
    accountingSnapshots: snapshots,
    cashFlows: allCashFlows.map((flow) => ({ occurred_at: flow.occurred_at, amount: flow.amount })),
    benchmarkSymbol: DEFAULT_BENCHMARK_SYMBOL,
    ...(benchmarkSeries === undefined ? {} : { benchmarkSeries }),
  })

  return {
    performance,
    benchmark_symbol: DEFAULT_BENCHMARK_SYMBOL,
    benchmark_label: 'SP Funds S&P 500 Sharia (SPUS)',
    benchmark_pending: benchmarkSeries === undefined,
    snapshot_count: snapshots.length,
    limitations,
  }
}

export async function getPerformanceReportFromStore(
  store: EventStore,
  benchmarkSeries: PerformanceBenchmarkPoint[] | undefined,
  options: PerformanceClock = {},
): Promise<AppPerformanceReport> {
  return buildPerformanceReport(await store.list(), benchmarkSeries, options)
}
