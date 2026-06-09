// Pure, deterministic performance projection: portfolio time-weighted return
// (TWR) across available NAV valuation snapshots, adjusting for cash flows, plus
// a benchmark return over the same window and the excess (portfolio − benchmark).
//
// This is a local accounting aid, not a broker statement. It never fetches; the
// caller supplies snapshots, cash flows, and an optional benchmark series.

export type PerformanceSnapshotInput = {
  /** Valuation date (YYYY-MM-DD), e.g. accounting period_end. */
  period_end: string
  /** Net asset value at period_end. */
  nav: number
}

export type PerformanceCashFlowInput = {
  /** Date the flow occurred (YYYY-MM-DD). */
  occurred_at: string
  /**
   * Signed external cash flow into the portfolio: deposits positive,
   * withdrawals negative. Dividends are external inflows (positive); fees are
   * outflows (negative). Matches AccountingCashFlow sign convention.
   */
  amount: number
}

export type PerformanceBenchmarkPoint = {
  date: string
  close: number
}

export type PerformanceInput = {
  accountingSnapshots: PerformanceSnapshotInput[]
  cashFlows: PerformanceCashFlowInput[]
  benchmarkSeries?: PerformanceBenchmarkPoint[]
  benchmarkSymbol: string
}

export type PerformanceResult =
  | { sufficient: false; reason: string; benchmark_symbol: string }
  | {
      sufficient: true
      period_start: string
      period_end: string
      portfolio_twr: number
      benchmark_return: number | null
      benchmark_reason?: string
      benchmark_symbol: string
      excess_return: number | null
    }

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits))
}

/**
 * Compute portfolio TWR vs a benchmark.
 *
 * TWR: sort NAV snapshots by date, then chain sub-period returns. For each
 * consecutive pair (start → end), the external cash flow that landed strictly
 * after the start date and up to/including the end date is netted out of the
 * ending NAV so the return reflects investment performance, not contributions:
 *
 *   subReturn = (endNAV − flowInSubPeriod) / startNAV − 1
 *
 * Sub-period growth factors are multiplied and 1 subtracted for the linked TWR.
 * Sub-periods with a non-positive starting NAV are skipped (cannot divide).
 */
export function computePerformance(input: PerformanceInput): PerformanceResult {
  const snapshots = [...input.accountingSnapshots]
    .filter((snapshot) => Number.isFinite(snapshot.nav))
    .sort((left, right) => left.period_end.localeCompare(right.period_end))

  if (snapshots.length < 2) {
    return {
      sufficient: false,
      reason: 'Need at least two valuation snapshots to compute a return.',
      benchmark_symbol: input.benchmarkSymbol,
    }
  }

  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  if (first === undefined || last === undefined) {
    return {
      sufficient: false,
      reason: 'Need at least two valuation snapshots to compute a return.',
      benchmark_symbol: input.benchmarkSymbol,
    }
  }

  const periodStart = first.period_end
  const periodEnd = last.period_end

  let growthFactor = 1
  let hasUsableSubPeriod = false
  for (let i = 1; i < snapshots.length; i += 1) {
    const prev = snapshots[i - 1]
    const current = snapshots[i]
    if (prev === undefined || current === undefined) {
      continue
    }
    if (prev.nav <= 0) {
      // Cannot compute a return from a non-positive starting base; skip.
      continue
    }
    const flowInSubPeriod = input.cashFlows
      .filter((flow) => flow.occurred_at > prev.period_end && flow.occurred_at <= current.period_end)
      .reduce((sum, flow) => sum + (Number.isFinite(flow.amount) ? flow.amount : 0), 0)
    const subReturn = (current.nav - flowInSubPeriod) / prev.nav - 1
    growthFactor *= 1 + subReturn
    hasUsableSubPeriod = true
  }

  if (!hasUsableSubPeriod) {
    return {
      sufficient: false,
      reason: 'Need at least two valuation snapshots with a positive starting NAV to compute a return.',
      benchmark_symbol: input.benchmarkSymbol,
    }
  }

  const portfolioTwr = round(growthFactor - 1)
  const benchmark = computeBenchmarkReturn(input.benchmarkSeries, periodStart, periodEnd)

  return {
    sufficient: true,
    period_start: periodStart,
    period_end: periodEnd,
    portfolio_twr: portfolioTwr,
    benchmark_return: benchmark.value,
    ...(benchmark.reason === undefined ? {} : { benchmark_reason: benchmark.reason }),
    benchmark_symbol: input.benchmarkSymbol,
    excess_return: benchmark.value === null ? null : round(portfolioTwr - benchmark.value),
  }
}

/**
 * Benchmark return over [start, end]: close at-or-just-before start vs
 * at-or-just-before end. Returns a reason instead of a value when the series is
 * missing or does not span the window.
 */
function computeBenchmarkReturn(
  series: PerformanceBenchmarkPoint[] | undefined,
  start: string,
  end: string,
): { value: number | null; reason?: string } {
  if (series === undefined || series.length === 0) {
    return { value: null, reason: 'Benchmark data unavailable / pending price feed.' }
  }

  const sorted = [...series]
    .filter((point) => Number.isFinite(point.close) && point.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date))

  const startClose = closeAtOrBefore(sorted, start)
  const endClose = closeAtOrBefore(sorted, end)

  if (startClose === undefined || endClose === undefined) {
    return { value: null, reason: 'Benchmark series does not cover the portfolio period.' }
  }
  if (startClose <= 0) {
    return { value: null, reason: 'Benchmark series has a non-positive starting close.' }
  }

  return { value: round(endClose / startClose - 1) }
}

function closeAtOrBefore(sortedAscending: PerformanceBenchmarkPoint[], date: string): number | undefined {
  let match: number | undefined
  for (const point of sortedAscending) {
    if (point.date <= date) {
      match = point.close
    } else {
      break
    }
  }
  // If every point is after `date`, fall back to the earliest available close so
  // a benchmark fetched for a slightly shorter range still aligns sensibly.
  if (match === undefined && sortedAscending.length > 0) {
    match = sortedAscending[0]?.close
  }
  return match
}
