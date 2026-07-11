import { fcfPerShareSeries, type Fundamentals } from './secEdgar'

/**
 * Cheapness screen (Phase 4, Task 4.1d; E2 re-based) — a SECOND admission funnel feeding the admit
 * judgment. It surfaces names that are cheap on FREE-CASH-FLOW yield (EV / FCF), but ONLY among
 * GATE-PASSING ("already wonderful") businesses. Cheapness alone is never the signal.
 *
 * E2 (owner-locked): owner earnings is retired — the yield basis is the SAME book FCF
 * (CFO − capex per diluted share, `fcfPerShareSeries`) the valuation core prices from. No
 * maintenance-capex proxy, no assumptions. See the no-drift test in `__tests__/cheapnessScreen.test.ts`.
 */

export type CheapnessInput = {
  /** From `fetchCompanyFundamentals` — carries `annual_series`, `latest_annual` (total_debt, cash, diluted_shares). */
  fundamentals: Fundamentals
  /** Market capitalization in $millions — price × diluted shares (caller supplies; no network here). */
  market_cap_musd: number
  /** Is this an "already wonderful" gate-passing business? (caller supplies the gate verdict). */
  gate_passing: boolean
  /** FCF yield at/above which the name is "cheap". Documented default: {@link DEFAULT_YIELD_THRESHOLD}. */
  yield_threshold?: number
}

export type CheapnessResult = {
  /** True ONLY when `gate_passing` AND `cheap`. The actual second-funnel admission signal. */
  surfaced: boolean
  /** FCF-yield ≥ threshold, computed independently of the gate (surfaced for transparency). */
  cheap: boolean
  /** Book FCF / EV (when computable). */
  fcf_yield?: number
  /** Enterprise value = market_cap + total_debt − cash (when computable). */
  ev_musd?: number
  /** The book FCF used: latest usable FCF/share × that year's diluted shares. */
  fcf_musd?: number
  /** Human-readable reason when the screen fails closed (FCF ≤ 0, EV ≤ 0, or missing inputs). */
  reason?: string
}

/**
 * Default FCF-yield threshold for "cheap" = 1 / exit_multiple_max (the 20× book-band ceiling) = 5%.
 * A SCREENING funnel, deliberately generous — the real discipline is the downstream 30%/50% margin
 * off the computed intrinsic value. Overridable via `CheapnessInput.yield_threshold`.
 */
export const DEFAULT_YIELD_THRESHOLD = 1 / 20

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function screenCheapness(input: CheapnessInput): CheapnessResult {
  const { fundamentals, market_cap_musd, gate_passing } = input
  const threshold = finite(input.yield_threshold) ? input.yield_threshold : DEFAULT_YIELD_THRESHOLD

  if (!finite(market_cap_musd)) {
    return { surfaced: false, cheap: false, reason: 'market_cap_musd missing or non-finite' }
  }

  // --- The book FCF (READ from the same series the valuation core prices from) ---
  const fcfSeries = fcfPerShareSeries(fundamentals.annual_series)
  if (fcfSeries.length === 0) {
    return { surfaced: false, cheap: false, reason: 'no usable FCF point (CFO/capex/shares missing)' }
  }
  const latestPoint = fcfSeries.reduce((a, b) => (b.fiscal_year > a.fiscal_year ? b : a))

  // Match the OE/share point back to ITS fiscal year's diluted share count (the series preserves order and
  // skips bad years, so the latest point's year may not be `latest_annual`). Fail closed if the matching
  // year's diluted share count is missing/non-positive (cannot scale OE/share → total OE honestly).
  const matchingYear = fundamentals.annual_series.find((a) => a.fiscal_year === latestPoint.fiscal_year)
  const dilutedShares = matchingYear?.diluted_shares_m
  if (!finite(dilutedShares) || !(dilutedShares > 0)) {
    return { surfaced: false, cheap: false, reason: 'diluted shares missing for the latest FCF point' }
  }

  const fcfMusd = latestPoint.oe_ps * dilutedShares
  if (!(fcfMusd > 0)) {
    return {
      surfaced: false,
      cheap: false,
      fcf_musd: fcfMusd,
      reason: 'free cash flow ≤ 0 (fail-closed)',
    }
  }

  // --- Enterprise value (from latest_annual balance-sheet facts) ---
  const debt = fundamentals.latest_annual.total_debt_musd
  const cash = fundamentals.latest_annual.cash_and_securities_musd
  if (debt !== undefined && !Number.isFinite(debt)) {
    return { surfaced: false, cheap: false, fcf_musd: fcfMusd, reason: 'total_debt non-finite' }
  }
  if (cash !== undefined && !Number.isFinite(cash)) {
    return { surfaced: false, cheap: false, fcf_musd: fcfMusd, reason: 'cash non-finite' }
  }
  const evMusd = market_cap_musd + (debt ?? 0) - (cash ?? 0)
  if (!(evMusd > 0)) {
    return {
      surfaced: false,
      cheap: false,
      fcf_musd: fcfMusd,
      ev_musd: evMusd,
      reason: 'enterprise value ≤ 0 (fail-closed)',
    }
  }

  const yieldValue = fcfMusd / evMusd
  const cheap = yieldValue >= threshold
  const surfaced = gate_passing && cheap

  return {
    surfaced,
    cheap,
    fcf_yield: yieldValue,
    ev_musd: evMusd,
    fcf_musd: fcfMusd,
  }
}
