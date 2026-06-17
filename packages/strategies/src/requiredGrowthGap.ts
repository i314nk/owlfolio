import type { MoatClass, StrategyContract } from './strategyContract'

/**
 * Arguments for the required-growth-gap engine.
 *
 * Mirrors `widenedMarginOfSafety`'s arg shape 1:1 — the SAME documented uncertainties widen the gap. This
 * is deliberate: the conservatism that used to live in the MoS price-haircut now lives ONLY here (F.13
 * one-knob discipline). The sustainable-growth BAND engine (sustainableGrowthBand.ts) carries NONE of
 * these inputs — it states, grounded in economics, what growth a business can fund; THIS engine is the
 * sole consumer of conservatism inputs.
 */
export type RequiredGrowthGapArgs = {
  /** Moat class — validated for the investability gate (mirrors widenedMarginOfSafety); not a gap lever post-F.13. */
  moat_class: MoatClass
  /** Terminal-value share of intrinsic value; widens when it exceeds terminal_value_share_flag. */
  terminal_value_pct_of_iv?: number
  /** Maintenance-capex estimate is low-confidence (Greenwald/D&A disagree, no gross PP&E). */
  low_maint_capex_confidence?: boolean
  /** Weak moat durability — incl. above-GDP growth, which IS a moat-durability claim. */
  weak_moat_durability?: boolean
  /** Sensitivity dispersion magnitude in [0,1]; scales sensitivity_dispersion_max. */
  sensitivity_dispersion?: number
}

/** Result of the required-growth-gap engine — the single conservatism knob, in GROWTH-RATE POINTS. */
export type RequiredGrowthGap = {
  /**
   * The required gap in GROWTH-RATE POINTS (e.g. 0.03 = 3 percentage points of growth). The decision layer
   * buys when `market_implied_growth ≤ band_low − required_gap` — so this is measured in growth-points, NOT
   * a price-percentage haircut.
   */
  required_gap: number
  /** The base gap before widening. */
  base: number
  /** True when any widening input bound. */
  widened: boolean
  /** Human-readable reasons each widening increment fired. */
  widening_reasons: string[]
}

/**
 * THE single conservatism knob, expressed as a required growth-rate GAP (valuation-core revision / F.13).
 *
 * Conservatism that previously lived in the margin-of-safety price haircut now lives ONLY in this gap. The
 * decision layer (a later slice) buys when `market_implied_growth ≤ band_low − required_gap`: the gap is the
 * margin the market-implied growth must clear BELOW the honest, grounded sustainable-growth band — so it is
 * measured in GROWTH-RATE POINTS, not a price percentage.
 *
 * WIDENING FACTORS transplant 1:1 from `widenedMarginOfSafety` (same conditions fire): a high terminal-value
 * share (> terminal_value_share_flag), low maintenance-capex confidence, weak moat durability (above-GDP
 * growth IS a moat-durability claim), and sensitivity dispersion (scaled in (0,1]). The total is clamped to
 * `base_gap + cap`.
 *
 * UNITS NOTE (load-bearing — do NOT transplant the MoS magnitudes verbatim): `margin_of_safety_widening`'s
 * increments (e.g. 0.10 = a 10% PRICE haircut) are in the WRONG units for a growth-point gap. Only the
 * FACTORS (which conditions widen) transplant 1:1; the MAGNITUDES in `required_growth_gap` are
 * growth-point-scaled PROVISIONAL placeholders, V8-owned (see valuationParams.ts).
 *
 * `moat_class` is validated for the investability gate only (mirrors widenedMarginOfSafety); post-F.13 it is
 * not a gap lever. Reads its config from `strategy.valuation.required_growth_gap`.
 */
export function requiredGrowthGap(
  strategy: StrategyContract,
  args: RequiredGrowthGapArgs,
): RequiredGrowthGap {
  const v = strategy.valuation
  const cfg = v.required_growth_gap
  const base = cfg.base_gap
  const w = cfg.widening
  let gap = base
  const reasons: string[] = []
  if (args.terminal_value_pct_of_iv !== undefined && args.terminal_value_pct_of_iv > v.terminal_value_share_flag) {
    gap += w.high_terminal_value_share
    reasons.push(`high terminal-value share (${(args.terminal_value_pct_of_iv * 100).toFixed(0)}% > ${(v.terminal_value_share_flag * 100).toFixed(0)}%)`)
  }
  if (args.low_maint_capex_confidence === true) {
    gap += w.low_maint_capex_confidence
    reasons.push('low maintenance-capex confidence')
  }
  if (args.weak_moat_durability === true) {
    gap += w.weak_moat_durability
    reasons.push('weak moat durability (above-GDP growth is a moat-durability claim)')
  }
  if (args.sensitivity_dispersion !== undefined && Number.isFinite(args.sensitivity_dispersion) && args.sensitivity_dispersion > 0) {
    const clamped = Math.min(1, Math.max(0, args.sensitivity_dispersion))
    gap += w.sensitivity_dispersion_max * clamped
    reasons.push(`sensitivity dispersion (${(clamped * 100).toFixed(0)}%)`)
  }
  // Clamp total widening to the configured cap ON TOP OF the base (mirrors how widenedMarginOfSafety caps,
  // but the cap here is a widening allowance over base_gap, not an absolute MoS cap).
  gap = Math.min(gap, base + w.cap)
  return { required_gap: gap, base, widened: reasons.length > 0, widening_reasons: reasons }
}
