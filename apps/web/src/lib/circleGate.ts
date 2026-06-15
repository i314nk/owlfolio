// Pre-spend circle-of-competence GATE for the research-start route (Task 4.1c, Part B).
//
// Runs the PURE `inCircle` check against the OWNER-SET boundary BEFORE any expensive research is spent,
// so an out-of-circle name is rejected before a research case is ever created. The boundary decision is
// config-only — there is NO LLM anywhere in this path. The gate only fetches the CHEAP pre-spend inputs
// (SIC + a single spot quote) the pure check needs, and only when the boundary is actually enabled.
//
// Fail-closed: under an ENABLED restrictive config, if SIC or market cap cannot be fetched, the candidate
// is rejected with a reason ("can't confirm in-circle") rather than admitted on missing data.

import {
  type CircleOfCompetenceConfig,
} from '@owlfolio/shared'
import { inCircle, type CircleCandidate } from '@owlfolio/workflow/circleOfCompetence'
import { fetchCompanyFundamentals, type Fundamentals } from '@owlfolio/workflow/secEdgar'
import { resolveCurrentPrice, type PriceQuote } from '@owlfolio/workflow/marketData'

export type CircleGateResult =
  | { allowed: true }
  | { allowed: false; reason: string }

export type CircleGateDeps = {
  fetchFundamentals?: (ticker: string) => Promise<Fundamentals | undefined>
  resolvePrice?: (ticker: string) => Promise<PriceQuote>
}

/** True when any market-cap bound is configured (so the gate must establish the cap). */
function capBoundSet(config: CircleOfCompetenceConfig): boolean {
  return config.min_market_cap_musd !== undefined || config.max_market_cap_musd !== undefined
}

/**
 * Evaluate the pre-spend circle gate for `ticker` against the owner-set `config`.
 *
 * - When `config.enabled !== true` (the permissive default) the gate is SKIPPED entirely: it returns
 *   `{ allowed: true }` WITHOUT any fetch, so the common path is untouched (no added latency/cost).
 * - When enabled, it fetches only the CHEAP pre-spend inputs the pure check needs — SIC (and, when a
 *   market-cap bound is configured, a single spot quote × diluted shares for the cap) — assembles the
 *   `CircleCandidate`, and runs `inCircle`. A rejection is returned verbatim with its reason.
 */
export async function evaluateCircleGate(
  config: CircleOfCompetenceConfig,
  ticker: string,
  deps: CircleGateDeps = {},
): Promise<CircleGateResult> {
  // Permissive default: do nothing, fetch nothing — keep the common path identical.
  if (config.enabled !== true) {
    return { allowed: true }
  }

  const fetchFundamentals = deps.fetchFundamentals ?? ((t: string) => fetchCompanyFundamentals(t))
  const resolvePrice = deps.resolvePrice ?? ((t: string) => resolveCurrentPrice({ ticker: t }))

  // SIC (cheap, single SEC fetch). Best-effort/fail-open at the source; an absent SIC under a restrictive
  // allowed-list is handled as a reject by the pure check (can't confirm in-circle).
  const fundamentals = await fetchFundamentals(ticker)
  const sic = fundamentals?.sic

  // Market cap = spot price × diluted shares — fetched ONLY when a cap bound is configured.
  let marketCapMusd: number | undefined
  if (capBoundSet(config)) {
    const dilutedSharesM = fundamentals?.latest_annual.diluted_shares_m
    const quote = await resolvePrice(ticker)
    if (
      quote.available
      && typeof dilutedSharesM === 'number'
      && Number.isFinite(dilutedSharesM)
      && dilutedSharesM > 0
    ) {
      marketCapMusd = quote.price_per_share * dilutedSharesM
    }
    // else: leave undefined → the pure check fails closed under a set bound (can't confirm).
  }

  const candidate: CircleCandidate = {
    ticker,
    ...(sic !== undefined ? { sic } : {}),
    ...(marketCapMusd !== undefined ? { market_cap_musd: marketCapMusd } : {}),
  }

  const result = inCircle(candidate, config)
  if (result.in_circle) {
    return { allowed: true }
  }
  return { allowed: false, reason: result.reason ?? 'Candidate is outside the configured circle of competence' }
}
