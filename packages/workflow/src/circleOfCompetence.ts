// PURE circle-of-competence check (Task 4.1c, Part A).
//
// The harness CHECKS a candidate against the OWNER-SET boundary in `CircleOfCompetenceConfig`; it
// NEVER infers the boundary. There is deliberately NO LLM and NO network in this path — same discipline
// as the discount anchor: an agent will rationalize almost anything into the circle, so the decision is
// config-only, deterministic, and reproducible.
//
// Safety property: the permissive default (`enabled: false`) ALWAYS admits — nothing is ever silently
// rejected until the owner deliberately narrows the boundary.

import type { CircleOfCompetenceConfig } from '@owlfolio/shared'

/** Minimal pre-spend candidate the check inspects. Fields are optional so unknown data fails CLOSED. */
export type CircleCandidate = {
  ticker: string
  /** SEC SIC code (e.g. '7372'), when known. Reported verbatim (not coerced/padded). */
  sic?: string
  /** Market cap in millions USD, when known. */
  market_cap_musd?: number
  /** Business archetype label (e.g. 'compounder'), when known. */
  archetype?: string
}

export type CircleResult = {
  in_circle: boolean
  /** Human-readable reason naming the rule that fired + the offending value. Present only on a reject. */
  reason?: string
}

/** True when `sic` prefix-matches any prefix in the list. */
function matchesAnyPrefix(sic: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => sic.startsWith(prefix))
}

/**
 * Deterministic, pure, NO-LLM, NO-network circle-of-competence check.
 *
 * - `config.enabled === false` (the permissive default) → `{ in_circle: true }` ALWAYS (short-circuits
 *   before any list/bound is consulted). This is the key safety property.
 * - When `enabled === true`, gates are evaluated in a FIXED order (first failure wins, most-specific
 *   first) so a candidate with multiple violations reports a deterministic reason:
 *     1. excluded_sic_prefixes — explicit out-of-circle sectors.
 *     2. allowed_sic_prefixes  — when non-empty, the sic MUST prefix-match one; an UNKNOWN sic rejects
 *        (can't confirm in-circle). (With no allowed-list, an unknown sic is not by itself a rejection.)
 *     3. allowed_archetypes    — when non-empty, the archetype MUST be listed; unknown rejects.
 *     4. min_market_cap_musd / max_market_cap_musd — when a bound is set, an out-of-bound OR UNKNOWN
 *        market cap rejects (an unset bound can't be confirmed → fail-closed).
 */
export function inCircle(candidate: CircleCandidate, config: CircleOfCompetenceConfig): CircleResult {
  // Permissive default: admit everything before consulting any list/bound.
  if (config.enabled !== true) {
    return { in_circle: true }
  }

  // 1. Excluded SIC prefixes — explicit out-of-circle sectors (most specific signal).
  const excluded = config.excluded_sic_prefixes
  if (excluded !== undefined && excluded.length > 0 && candidate.sic !== undefined) {
    if (matchesAnyPrefix(candidate.sic, excluded)) {
      return {
        in_circle: false,
        reason: `SIC ${candidate.sic} matches an excluded SIC prefix (${excluded.join(', ')})`,
      }
    }
  }

  // 2. Allowed SIC prefixes — when set, the candidate's sic must prefix-match one.
  const allowedSic = config.allowed_sic_prefixes
  if (allowedSic !== undefined && allowedSic.length > 0) {
    if (candidate.sic === undefined) {
      return {
        in_circle: false,
        reason: `SIC is unknown; cannot confirm it is within the allowed SIC prefixes (${allowedSic.join(', ')})`,
      }
    }
    if (!matchesAnyPrefix(candidate.sic, allowedSic)) {
      return {
        in_circle: false,
        reason: `SIC ${candidate.sic} is outside the allowed SIC prefixes (${allowedSic.join(', ')})`,
      }
    }
  }

  // 3. Allowed archetypes — when set, the candidate's archetype must be listed.
  const allowedArchetypes = config.allowed_archetypes
  if (allowedArchetypes !== undefined && allowedArchetypes.length > 0) {
    if (candidate.archetype === undefined) {
      return {
        in_circle: false,
        reason: `archetype is unknown; cannot confirm it is within the allowed archetypes (${allowedArchetypes.join(', ')})`,
      }
    }
    if (!allowedArchetypes.includes(candidate.archetype)) {
      return {
        in_circle: false,
        reason: `archetype "${candidate.archetype}" is outside the allowed archetypes (${allowedArchetypes.join(', ')})`,
      }
    }
  }

  // 4. Market-cap bounds — when a bound is set, an unknown cap can't be confirmed (fail-closed).
  const min = config.min_market_cap_musd
  const max = config.max_market_cap_musd
  if (min !== undefined || max !== undefined) {
    const cap = candidate.market_cap_musd
    if (cap === undefined || !Number.isFinite(cap)) {
      return {
        in_circle: false,
        reason: 'market cap is unknown; cannot confirm it is within the configured market-cap bounds',
      }
    }
    if (min !== undefined && cap < min) {
      return {
        in_circle: false,
        reason: `market cap ${cap} musd is below the minimum bound of ${min} musd`,
      }
    }
    if (max !== undefined && cap > max) {
      return {
        in_circle: false,
        reason: `market cap ${cap} musd is above the maximum bound of ${max} musd`,
      }
    }
  }

  return { in_circle: true }
}
