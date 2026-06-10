import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import {
  projectAccountingSnapshot,
  type AccountingCashFlow,
} from '@owlfolio/ledger/projections/accountingProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import {
  computePerformance,
  type PerformanceBenchmarkPoint,
  type PerformanceResult,
} from '@owlfolio/workflow/performanceProjection'
import {
  computePortfolioAnalytics,
  type PortfolioAnalytics,
} from '@owlfolio/workflow/portfolioAnalytics'
import {
  computeDisciplineReports,
  type DisciplineReports,
  type DisciplineHoldingInput,
  type GateOverrideCheckInput,
} from '@owlfolio/workflow/disciplineReports'

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
  /** Module 8: money-weighted return + per-position contribution + realized/unrealized split. */
  analytics: PortfolioAnalytics
  /** Module 8: discount-at-purchase, gate-override integrity count, thesis-review latency. */
  discipline: DisciplineReports
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

function payloadRecord(event: LedgerEventEnvelope<unknown>): Record<string, unknown> | undefined {
  const payload = event.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  return payload as Record<string, unknown>
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/** Sum realized gains and dividends per holding_id from the ledger. */
function realizedAndDividendsByHolding(
  events: LedgerEventEnvelope<unknown>[],
  currency: string,
): Map<string, { realized: number; dividends: number }> {
  const byHolding = new Map<string, { realized: number; dividends: number }>()
  for (const event of events) {
    const record = payloadRecord(event)
    if (record === undefined) continue
    if (stringField(record, 'currency') !== currency) continue
    const holdingId = stringField(record, 'holding_id')
    if (holdingId === undefined) continue
    const amount = numberField(record, 'amount')
    if (amount === undefined) continue
    const entry = byHolding.get(holdingId) ?? { realized: 0, dividends: 0 }
    if (event.event_type === 'holding_realized_gain_loss_recorded') {
      entry.realized += amount
    } else if (event.event_type === 'dividend_income_recorded') {
      entry.dividends += amount
    }
    byHolding.set(holdingId, entry)
  }
  return byHolding
}

/**
 * Integrity check (Module 8 discipline): a hard-gate-failing dimension on a case
 * whose authored verdict is BUY. Deterministic and conservative — derived from
 * the projected case (moat gate failed, Shariah FAIL, non-positive normalized OE).
 * Expected to be EMPTY (count 0 = green).
 */
function gateOverrideChecks(events: LedgerEventEnvelope<unknown>[]): GateOverrideCheckInput[] {
  return projectResearchCases(events).map((researchCase) => {
    const failing: string[] = []
    if (researchCase.valuation?.moat_passes_gate === false) failing.push('moat')
    const shariah = (researchCase.shariah_status ?? researchCase.shariah_financial?.verdict ?? '').toUpperCase()
    if (shariah === 'FAIL' || shariah === 'NON_COMPLIANT') failing.push('shariah')
    const oePs = researchCase.valuation?.normalized_owner_earnings_per_share
    if (oePs !== undefined && oePs <= 0) failing.push('oe_positive')

    const check: GateOverrideCheckInput = {
      research_case_id: researchCase.research_case_id,
      failing_hard_gates: failing,
    }
    if (researchCase.investment_verdict !== undefined) check.investment_verdict = researchCase.investment_verdict
    if (researchCase.ticker !== undefined) check.ticker = researchCase.ticker
    return check
  })
}

function buildAnalyticsAndDiscipline(
  events: LedgerEventEnvelope<unknown>[],
  allCashFlows: AccountingCashFlow[],
  now: Date,
  currency: string,
): { analytics: PortfolioAnalytics; discipline: DisciplineReports } {
  const holdings = projectHoldings(events)
  const researchCases = projectResearchCases(events)
  const caseById = new Map(researchCases.map((entry) => [entry.research_case_id, entry]))
  const realizedByHolding = realizedAndDividendsByHolding(events, currency)
  const asOf = now.toISOString().slice(0, 10)

  // Per-position contribution + realized/unrealized inputs.
  const positions = holdings.map((holding) => {
    const realized = realizedByHolding.get(holding.holding_id) ?? { realized: 0, dividends: 0 }
    return {
      holding_id: holding.holding_id,
      ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
      total_cost_basis: holding.total_cost_basis,
      market_value: holding.latest_market_value ?? 0,
      realized_gain_loss: realized.realized,
      dividends_received: realized.dividends,
    }
  })

  // MWR cash flows: external flows (deposits/withdrawals neutral to MWR are
  // excluded — we measure the investment IRR), buys (negative cost basis at
  // open) + dividends/sells (positive). We reuse the accounting cash flows
  // (dividends positive, fees negative) plus position cost-basis outflows.
  const mwrFlows = holdings.map((holding) => ({ occurred_at: holding.opened_at, amount: -holding.total_cost_basis }))
  for (const flow of allCashFlows) {
    if (flow.flow_type === 'dividend') {
      mwrFlows.push({ occurred_at: flow.occurred_at, amount: flow.amount })
    }
  }
  const endingMarketValue = holdings.reduce((sum, holding) => sum + (holding.latest_market_value ?? 0), 0)

  const analytics = computePortfolioAnalytics({
    as_of: asOf,
    cashFlows: mwrFlows,
    endingMarketValue,
    positions,
  })

  // Discount-at-purchase: entry cost vs the case's fair value / buy price.
  const disciplineHoldings: DisciplineHoldingInput[] = holdings.map((holding) => {
    const researchCase = caseById.get(holding.research_case_id)
    const input: DisciplineHoldingInput = {
      holding_id: holding.holding_id,
      entry_cost_basis_per_share: holding.cost_basis_per_share,
    }
    if (holding.ticker !== undefined) input.ticker = holding.ticker
    const fv = researchCase?.valuation?.fair_value_per_share
    if (fv !== undefined) input.fair_value_per_share = fv
    const buy = researchCase?.valuation?.buy_price_per_share
    if (buy !== undefined) input.buy_price_per_share = buy
    if (holding.latest_price_per_share !== undefined) input.latest_price_per_share = holding.latest_price_per_share
    return input
  })

  const discipline = computeDisciplineReports({
    holdings: disciplineHoldings,
    cases: gateOverrideChecks(events),
  })

  return { analytics, discipline }
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

  const { analytics, discipline } = buildAnalyticsAndDiscipline(events, allCashFlows, now, currency)

  return {
    performance,
    benchmark_symbol: DEFAULT_BENCHMARK_SYMBOL,
    benchmark_label: 'SP Funds S&P 500 Sharia (SPUS)',
    benchmark_pending: benchmarkSeries === undefined,
    snapshot_count: snapshots.length,
    analytics,
    discipline,
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
