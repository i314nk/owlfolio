// PURE OWNER-POLICY HARD-EXCLUSION check (Task 4.1c, Part A).
//
// IMPORTANT — what this is NOT: this is NOT the circle-of-competence COMPETENCE judgment. "Do I understand
// THIS business well enough to assess its cashflow predictability?" is a GROUNDED MODEL JUDGMENT and lives
// in the deep-dive phase (researchSwarm.ts → judgeCircleCompetence + the circle gate, emitting
// circle_competence_judged). THIS module is a cheap, deterministic OWNER-POLICY PRE-FILTER: an owner-chosen
// set of categorical hard-exclusions ("I categorically WON'T invest in sector/archetype/size X" — an owner
// CHOICE, not a competence claim). It is a pre-spend gate at the research-start route, NOT a demonstration
// of understanding. The H1 confusion (this config screen standing in for the competence judgment) must not
// recur: the COMPETENCE judgment is the model's; THIS is the owner's policy.
//
// The harness CHECKS a candidate against the OWNER-SET policy in `CircleOfCompetenceConfig` (the config KEY
// stays `circle_of_competence` for persisted-config back-compat; its MEANING is owner-policy exclusions);
// it NEVER infers the policy. There is deliberately NO LLM and NO network in this path — an agent will
// rationalize almost anything past an exclusion, so the owner's hard-exclusions are config-only,
// deterministic, and reproducible.
//
// Safety property: the permissive default (`enabled: false`) ALWAYS admits — nothing is ever silently
// excluded until the owner deliberately narrows the policy.

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
 * Deterministic, pure, NO-LLM, NO-network OWNER-POLICY hard-exclusion check (NOT a competence judgment —
 * see the file header). Kept named `inCircle` / `in_circle` for back-compat with the research-start route
 * and existing configs; semantically it answers "does the candidate pass the owner's categorical
 * hard-exclusion policy?" (the alias {@link passesOwnerPolicy} reads truer at new call sites).
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

/**
 * Truer-reading alias for {@link inCircle}: this gate answers whether a candidate passes the OWNER's
 * categorical hard-exclusion POLICY (sector/archetype/market-cap), NOT whether the model is competent to
 * judge the business (that is the grounded model judgment in the deep-dive circle gate). New owner-policy
 * call sites should prefer this name; `inCircle` is retained for the existing route + config back-compat.
 */
export const passesOwnerPolicy = inCircle
