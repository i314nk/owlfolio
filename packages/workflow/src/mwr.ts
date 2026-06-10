// Pure, deterministic money-weighted return (MWR / dollar-weighted IRR).
//
// Computes the annualized internal rate of return on a dated cash-flow series:
//   buys are outflows (negative), sells + dividends are inflows (positive),
//   and the ending market value is the terminal inflow.
//
// The NPV equation, with t_i measured in YEARS from the first flow date:
//   Σ amount_i / (1 + r)^t_i = 0
//
// Solved by bisection over a sane bracket, falling back to not-computable when
// there is no sign change (no real IRR exists) or the data is insufficient.
// MWR sits ALONGSIDE the existing time-weighted return; it answers a different
// question (the investor's actual realized rate given the timing of flows).

export type MwrCashFlow = {
  /** Date the flow occurred (YYYY-MM-DD). */
  occurred_at: string
  /**
   * Signed cash flow from the investor's perspective: buys negative (outflow),
   * sells + dividends positive (inflow). The ending market value of open
   * positions is supplied as a terminal positive inflow at the as-of date.
   */
  amount: number
}

export type MwrResult =
  | { computable: false; reason: string }
  | { computable: true; mwr: number; period_years: number; flow_count: number }

const DAYS_PER_YEAR = 365

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00.000Z`)
  const to = Date.parse(`${toISO}T00:00:00.000Z`)
  return (to - from) / (1000 * 60 * 60 * 24)
}

/** NPV of the flows at annual rate r, with times in years from the base date. */
function npv(flows: { years: number; amount: number }[], rate: number): number {
  let total = 0
  for (const flow of flows) {
    total += flow.amount / Math.pow(1 + rate, flow.years)
  }
  return total
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits))
}

export function computeMoneyWeightedReturn(cashFlows: MwrCashFlow[]): MwrResult {
  const usable = cashFlows.filter((flow) => Number.isFinite(flow.amount))
  if (usable.length < 2) {
    return { computable: false, reason: 'Need at least two dated cash flows to compute a money-weighted return.' }
  }

  const sorted = [...usable].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))
  const base = sorted[0]
  if (base === undefined) {
    return { computable: false, reason: 'Need at least two dated cash flows to compute a money-weighted return.' }
  }

  const flows = sorted.map((flow) => ({
    years: daysBetween(base.occurred_at, flow.occurred_at) / DAYS_PER_YEAR,
    amount: flow.amount,
  }))

  const periodYears = flows[flows.length - 1]?.years ?? 0
  if (periodYears <= 0) {
    return { computable: false, reason: 'Cash flows do not span a positive time window.' }
  }

  const hasPositive = flows.some((flow) => flow.amount > 0)
  const hasNegative = flows.some((flow) => flow.amount < 0)
  if (!hasPositive || !hasNegative) {
    return {
      computable: false,
      reason: 'No sign change in the cash-flow series; an internal rate of return is undefined (need opposing inflows and outflows).',
    }
  }

  // Bracket the root. IRR for an equity series lives comfortably within
  // (-0.999, +large). Scan for a sign change of NPV over a wide bracket.
  const lowerBound = -0.9999
  const upperBound = 1_000 // 100,000% — generous ceiling for short, explosive series.

  let lo = lowerBound
  let hi = upperBound
  let npvLo = npv(flows, lo)
  const npvHi = npv(flows, hi)

  if (!Number.isFinite(npvLo) || !Number.isFinite(npvHi)) {
    return { computable: false, reason: 'Cash-flow discounting overflowed; money-weighted return is not computable.' }
  }

  if (npvLo === 0) {
    return { computable: true, mwr: round(lo), period_years: round(periodYears, 4), flow_count: flows.length }
  }
  if (npvHi === 0) {
    return { computable: true, mwr: round(hi), period_years: round(periodYears, 4), flow_count: flows.length }
  }

  if (Math.sign(npvLo) === Math.sign(npvHi)) {
    return {
      computable: false,
      reason: 'No real internal rate of return within the supported bracket; money-weighted return is not computable.',
    }
  }

  // Bisection: NPV is monotonic-enough over the bracket for a standard
  // buy-then-sell-plus-dividends series (one sign change in the flows).
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (lo + hi) / 2
    const npvMid = npv(flows, mid)
    if (!Number.isFinite(npvMid)) {
      hi = mid
      continue
    }
    if (Math.abs(npvMid) < 1e-9 || (hi - lo) / 2 < 1e-10) {
      return { computable: true, mwr: round(mid), period_years: round(periodYears, 4), flow_count: flows.length }
    }
    if (Math.sign(npvMid) === Math.sign(npvLo)) {
      lo = mid
      npvLo = npvMid
    } else {
      hi = mid
    }
  }

  return { computable: true, mwr: round((lo + hi) / 2), period_years: round(periodYears, 4), flow_count: flows.length }
}
