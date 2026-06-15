import { ownerEarningsPerShareSeries, type Fundamentals } from './secEdgar'

/**
 * Cheapness screen (Phase 4, Task 4.1d) — a SECOND admission funnel feeding the admit judgment.
 *
 * It surfaces names that are cheap on owner-earnings yield, but ONLY among GATE-PASSING ("already
 * wonderful") businesses. Cheapness alone is never the signal; cheapness ON a wonderful business is.
 *
 * LOAD-BEARING DISCIPLINE: this screen is a READER of the Phase-1 valuation core, not a re-implementation.
 * It uses the maintenance-capex-adjusted, SBC-handled owner earnings already computed by
 * `ownerEarningsPerShareSeries` (the SAME normalized OE the valuation core uses). It must NOT compute a
 * shortcut NI-based OE here — a second definition of "cheap" would silently drift from what the valuation
 * core would actually call cheap. See the no-drift test in `__tests__/cheapnessScreen.test.ts`.
 */

export type CheapnessInput = {
  /** From `fetchCompanyFundamentals` — carries `annual_series`, `latest_annual` (total_debt, cash, diluted_shares). */
  fundamentals: Fundamentals
  /** Market capitalization in $millions — price × diluted shares (caller supplies; no network here). */
  market_cap_musd: number
  /** Is this an "already wonderful" gate-passing business? (caller supplies the gate verdict). */
  gate_passing: boolean
  /** Owner-earnings yield at/above which the name is "cheap". Documented default: {@link DEFAULT_YIELD_THRESHOLD}. */
  yield_threshold?: number
}

export type CheapnessResult = {
  /** True ONLY when `gate_passing` AND `cheap`. The actual second-funnel admission signal. */
  surfaced: boolean
  /** OE-yield ≥ threshold, computed independently of the gate (surfaced for transparency). */
  cheap: boolean
  /** Phase-1 normalized OE / EV (when computable). */
  owner_earnings_yield?: number
  /** Enterprise value = market_cap + total_debt − cash (when computable). */
  ev_musd?: number
  /** The Phase-1 normalized OE used: latest usable normalized OE/share × that year's diluted shares. */
  owner_earnings_musd?: number
  /** Human-readable reason when the screen fails closed (OE ≤ 0, EV ≤ 0, or missing inputs). */
  reason?: string
}

/**
 * Default owner-earnings-yield threshold for "cheap" = 1 / fv_cap_multiple (18×) ≈ 0.0556 (EV/OE ≤ 18×).
 *
 * Rationale: this is a SCREENING funnel, deliberately generous — the real valuation discipline is the
 * Phase-1 buy-below-fair-value test downstream, NOT this screen. The strategy's fair-value SANITY-FLAG
 * multiple is 18× owner earnings (`VALUATION_PARAMS.fv_cap_multiple`); a name trading at/below ~18× OE
 * (yield ≥ ~5.56%) is plausibly inside the zone where the downstream valuation could find a margin of
 * safety, so it is worth surfacing for the deeper admit judgment. The stricter ~10% discount-rate yield
 * (EV/OE ≤ 10×) is intentionally NOT used here — that would pre-empt the valuation core and over-filter
 * the funnel. Overridable via `CheapnessInput.yield_threshold`.
 */
export const DEFAULT_YIELD_THRESHOLD = 1 / 18

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function screenCheapness(input: CheapnessInput): CheapnessResult {
  const { fundamentals, market_cap_musd, gate_passing } = input
  const threshold = finite(input.yield_threshold) ? input.yield_threshold : DEFAULT_YIELD_THRESHOLD

  if (!finite(market_cap_musd)) {
    return { surfaced: false, cheap: false, reason: 'market_cap_musd missing or non-finite' }
  }

  // --- Phase-1 owner earnings (READ, never recomputed) ---
  // Use the SAME normalized series the valuation core uses, then take the latest usable point.
  const oeSeries = ownerEarningsPerShareSeries(fundamentals.annual_series)
  if (oeSeries.length === 0) {
    return { surfaced: false, cheap: false, reason: 'no usable Phase-1 owner-earnings point (missing inputs)' }
  }
  const latestPoint = oeSeries.reduce((a, b) => (b.fiscal_year > a.fiscal_year ? b : a))

  // Match the OE/share point back to ITS fiscal year's diluted share count (the series preserves order and
  // skips bad years, so the latest point's year may not be `latest_annual`). Fail closed if the matching
  // year's diluted share count is missing/non-positive (cannot scale OE/share → total OE honestly).
  const matchingYear = fundamentals.annual_series.find((a) => a.fiscal_year === latestPoint.fiscal_year)
  const dilutedShares = matchingYear?.diluted_shares_m
  if (!finite(dilutedShares) || !(dilutedShares > 0)) {
    return { surfaced: false, cheap: false, reason: 'diluted shares missing for the latest OE point' }
  }

  const ownerEarningsMusd = latestPoint.oe_ps * dilutedShares
  if (!(ownerEarningsMusd > 0)) {
    return {
      surfaced: false,
      cheap: false,
      owner_earnings_musd: ownerEarningsMusd,
      reason: 'normalized owner earnings ≤ 0 (fail-closed)',
    }
  }

  // --- Enterprise value (from latest_annual balance-sheet facts) ---
  const debt = fundamentals.latest_annual.total_debt_musd
  const cash = fundamentals.latest_annual.cash_and_securities_musd
  if (debt !== undefined && !Number.isFinite(debt)) {
    return { surfaced: false, cheap: false, owner_earnings_musd: ownerEarningsMusd, reason: 'total_debt non-finite' }
  }
  if (cash !== undefined && !Number.isFinite(cash)) {
    return { surfaced: false, cheap: false, owner_earnings_musd: ownerEarningsMusd, reason: 'cash non-finite' }
  }
  const evMusd = market_cap_musd + (debt ?? 0) - (cash ?? 0)
  if (!(evMusd > 0)) {
    return {
      surfaced: false,
      cheap: false,
      owner_earnings_musd: ownerEarningsMusd,
      ev_musd: evMusd,
      reason: 'enterprise value ≤ 0 (fail-closed)',
    }
  }

  const yieldValue = ownerEarningsMusd / evMusd
  const cheap = yieldValue >= threshold
  const surfaced = gate_passing && cheap

  return {
    surfaced,
    cheap,
    owner_earnings_yield: yieldValue,
    ev_musd: evMusd,
    owner_earnings_musd: ownerEarningsMusd,
  }
}
