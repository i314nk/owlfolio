// Pre-spend OWNER-POLICY hard-exclusion GATE for the research-start route (Task 4.1c, Part B).
//
// IMPORTANT — what this is NOT: this is NOT the circle-of-competence COMPETENCE judgment ("do I understand
// THIS business well enough to assess its cashflow predictability?"). That is a GROUNDED MODEL JUDGMENT
// that runs as a sequential pre-deep-dive stage inside the swarm (researchSwarm.ts → the circle gate,
// emitting circle_competence_judged). THIS gate is the cheap, owner-controlled PRE-SPEND PRE-FILTER: it
// enforces the owner's categorical hard-exclusions (sector/archetype/market-cap — "I categorically won't
// invest in X", an owner CHOICE) BEFORE any expensive research is spent, so an excluded name is rejected
// before a research case is ever created.
//
// Runs the PURE owner-policy `inCircle` check against the OWNER-SET policy. The decision is config-only —
// there is NO LLM anywhere in this path. The gate only fetches the CHEAP pre-spend inputs (SIC + a single
// spot quote) the pure check needs, and only when the policy is actually enabled.
//
// Fail-closed: under an ENABLED restrictive policy, if SIC or market cap cannot be fetched, the candidate
// is rejected with a reason ("can't confirm it passes the owner policy") rather than admitted on missing data.

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
