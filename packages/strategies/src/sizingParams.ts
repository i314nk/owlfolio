// Versioned position-sizing parameter config — the SINGLE source of truth for every sizing/tranche
// constant (position-sizing-spec §1, §2, §4, §7; acceptance test #7).
//
// Mirrors valuationParams.ts: a frozen, versioned object. NO sizing constant (target weight, per-name
// cap, ladder fraction, tranche trigger, time-completion window, regime threshold) is hardcoded in the
// sizing/tranche engine — the engine reads EVERY number from here. A test that mutates this config (e.g.
// time_completion_months 6 → 3) changes engine behaviour with no code change (acceptance #7).
//
// Anti-drift (same rule as valuation parameters): decide fractions / N by the calibration backtest's
// deployment-ratio metric before go-live, then freeze. Post-go-live changes only at the annual system
// review with a backtest re-run attached (spec §7).
//
// SLEEVES ARE DEFERRED (owner directive): the 15% per_name_cap is enforced PER NAME for the single
// Buffett-Munger strategy, NOT as a cross-sleeve aggregate. The `sleeve_id` seam below keeps the
// sleeve-preset hook from being designed out without building any sleeve handling now (spec §6).
//
// TEMPERATURE IS DEFERRED (the Marks regime overlay is a deferred strategy-addition): ladder selection
// reads the threshold below, but the temperature INPUT is hooked/defaulted — see suggestLadder. Until
// the overlay lands, selection defaults to `default_ladder` (normal 60/40).

/** A tranche's price trigger kind. `buy` fires at/below the (re-anchored) buy price; `minus_10`/
 *  `minus_20` at buy×0.90 / buy×0.80. New trigger kinds are added here, never hardcoded in logic. */
export type TrancheTrigger = 'buy' | 'minus_10' | 'minus_20'

/** One rung of a ladder. `fraction` is a proportion of the target position weight; rungs sum to 1.0. */
export type LadderRung = {
  id: string
  fraction: number
  trigger: TrancheTrigger
}

/** A named ladder definition (the ordered rungs + an optional per-ladder time-completion override). */
export type LadderDef = {
  rungs: readonly LadderRung[]
  /** Per-ladder override of time_completion_months (spec §4 "per-ladder override allowed"). */
  time_completion_months?: number
}

/** The available ladder ids. Cold = dislocation 40/30/30; normal/warm = 60/40 two-tranche. */
export type LadderId = 'cold' | 'normal'

export type MoatTieredWeight = {
  monopoly: number
  wide: number
}

/**
 * The full versioned sizing parameter set. Every number the sizing/tranche engine needs lives here.
 * Bump `version` on any change and (when wired to the ledger) log a sizing-config event diff.
 */
export type SizingParams = {
  /** Monotonic version string. Bump on every parameter change. */
  version: string
  /** Target entry weight by moat tier (spec §1): monopoly 10%, wide 6%. */
  target_weight_by_moat: MoatTieredWeight
  /** Hard per-name cap (spec §1): 15% per name. Sleeves deferred → per-name, not cross-sleeve. */
  per_name_cap: number
  /** Target number of names at full build-out (spec §1): ~20. */
  target_names: number
  /** The ladder definitions (spec §2): cold 40/30/30, normal 60/40. */
  ladders: Record<LadderId, LadderDef>
  /**
   * Regime temperature threshold (spec §2): temperature ≤ this → normal ladder; ≥ this+1 → cold.
   * 7 means ≤7 normal, ≥8 cold. The temperature INPUT is deferred/hooked (see suggestLadder).
   */
  regime_temperature_threshold: number
  /** Default time-completion window in months (spec §4): 6. Per-ladder override via LadderDef. */
  time_completion_months: number
  /** The ladder used when no temperature is available (the deferred-overlay default): normal. */
  default_ladder: LadderId
}

/**
 * The frozen DEFAULT sizing parameters (position-sizing-spec values).
 *
 *   target weights:  monopoly 10%, wide 6%
 *   per-name cap:    15% (per name — sleeves deferred)
 *   cold ladder:     T1 40% @ buy, T2 30% @ −10%, T3 30% @ −20%
 *   normal ladder:   T1 60% @ buy, T2 40% @ −10%
 *   regime split:    ≤7 normal, ≥8 cold (temperature input deferred/hooked)
 *   time-completion: 6 months
 *   default ladder:  normal (used until the temperature overlay lands)
 */
export const SIZING_PARAMS: SizingParams = Object.freeze({
  version: 'sizing-2026-06-position-sizing-1',
  target_weight_by_moat: { monopoly: 0.10, wide: 0.06 },
  per_name_cap: 0.15,
  target_names: 20,
  ladders: {
    cold: {
      rungs: [
        { id: 'T1', fraction: 0.40, trigger: 'buy' },
        { id: 'T2', fraction: 0.30, trigger: 'minus_10' },
        { id: 'T3', fraction: 0.30, trigger: 'minus_20' },
      ],
    },
    normal: {
      rungs: [
        { id: 'T1', fraction: 0.60, trigger: 'buy' },
        { id: 'T2', fraction: 0.40, trigger: 'minus_10' },
      ],
    },
  },
  regime_temperature_threshold: 7,
  time_completion_months: 6,
  default_ladder: 'normal',
}) as SizingParams

/** The multiplier applied to the buy price for each trigger kind (config-derived, not hardcoded). */
export const TRANCHE_TRIGGER_MULTIPLIER: Record<TrancheTrigger, number> = Object.freeze({
  buy: 1.0,
  minus_10: 0.90,
  minus_20: 0.80,
})
