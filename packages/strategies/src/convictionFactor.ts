// Phase 5 S1 — conviction_factor × base_target_weight (the anti-Kelly position-sizing slice).
//
// Position target = base_target_weight (~0.10) × conviction_factor, where conviction_factor ∈ (0,1]
// is composed DETERMINISTICALLY from existing gate outputs. There is NO new agent score and NO
// probability/odds/edge term — this is deliberately NOT Kelly. Conviction only scales the target DOWN;
// nothing ever targets above base_target_weight.
//
// ISLAND: pure, deterministic, no I/O, no LLM. NOT wired into computePositionPlan / the cadence / the
// flow yet (that is Phase 5 S6/S7). Every constant is read from SIZING_PARAMS — no hardcoded numbers.

import { SIZING_PARAMS, type SizingParams } from './sizingParams'
import type { MoatClass } from './strategyContract'

/** A permanent-loss / uncertainty level, mirroring admitJudgment.RiskLevel. */
type RiskLevel = 'low' | 'medium' | 'high'

export type ConvictionInputs = {
  /** From the strategy contract (investable: `wide` | `monopoly`). */
  moat_class: MoatClass
  /** From admit_recommendation.permanent_loss_risk.level. */
  permanent_loss_level: RiskLevel
  /** From admit_recommendation.uncertainty.level. */
  uncertainty_level: RiskLevel
  // Discount-depth inputs are accepted ONLY for the OFF-by-default optional factor (see below).
  buy_price_per_share?: number
  current_price?: number
}

/** The per-component audit trail (each ≤ 1; the product is the conviction factor). */
export type ConvictionComponents = {
  moat_factor: number
  permanent_loss_subfactor: number
  uncertainty_subfactor: number
  loss_uncertainty_factor: number
  /** Present ONLY when conviction_use_discount_depth is enabled; otherwise undefined (default-off). */
  discount_depth_factor?: number
  product: number
}

export type ConvictionResult =
  | {
      status: 'ok'
      factor: number
      target_weight: number
      components: ConvictionComponents
      reason: string
    }
  | { status: 'cannot_size'; reason: string }

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/**
 * Computes the deterministic conviction factor and the resulting position target weight.
 *
 * DEFAULT composition: `factor = moat_factor × loss_uncertainty_factor` (both ≤ 1 → product only
 * scales DOWN). `loss_uncertainty_factor = permanent_loss_subfactor × uncertainty_subfactor`.
 *
 * `discount_depth_factor` is DEFAULT OFF (config-gated). It is NOT multiplied into the product unless
 * `params.conviction_use_discount_depth` is true. Why off (the load-bearing rationale): discount depth
 * already gates *whether* you buy (the deployment hurdle + the buy-below crossing). Letting it also
 * scale *how much* double-counts the discount AND tilts the largest positions toward the deepest-fallen
 * names — disproportionately real impairments. A permanent-loss-first system must NOT size UP on depth.
 * Conviction tracks quality + safety (moat + how the floor holds), never how cheap it got.
 *
 * Fail-closed: a non-investable moat, a `high` permanent-loss level (should never reach sizing — it is
 * not-admittable), or (when discount-depth is ENABLED) a missing/non-finite price → `cannot_size`.
 */
export function computeConvictionFactor(
  inputs: ConvictionInputs,
  params: SizingParams = SIZING_PARAMS,
): ConvictionResult {
  const { moat_class, permanent_loss_level, uncertainty_level } = inputs

  // --- moat_factor: the only surviving moat-tier use — a sizing down-weight, NOT a valuation lever. ---
  const moatTable = params.conviction_moat_factor as Record<string, number>
  const moat_factor = moatTable[moat_class]
  if (moat_factor === undefined) {
    return {
      status: 'cannot_size',
      reason:
        `moat_class '${moat_class}' is not an investable moat (only wide|monopoly are sizeable) — `
        + 'cannot size.',
    }
  }

  // --- permanent_loss_subfactor: high should never reach sizing (not-admittable); fail closed if it does. ---
  if (permanent_loss_level === 'high') {
    return {
      status: 'cannot_size',
      reason:
        'permanent_loss_level is HIGH — a permanently impaired name is not-admittable and must never be '
        + 'sized; cannot size (fail-closed).',
    }
  }
  const permanent_loss_subfactor = params.conviction_permanent_loss_subfactor[permanent_loss_level]

  // --- uncertainty_subfactor: a SOFT down-weight only — high uncertainty is the opportunity (Pabrai P7). ---
  const uncertainty_subfactor =
    uncertainty_level === 'high'
      ? params.conviction_uncertainty_subfactor.high
      : params.conviction_uncertainty_subfactor.default

  const loss_uncertainty_factor = permanent_loss_subfactor * uncertainty_subfactor

  // --- discount_depth_factor: DEFAULT OFF. Only computed/multiplied when explicitly enabled. ---
  let discount_depth_factor: number | undefined
  if (params.conviction_use_discount_depth) {
    const { buy_price_per_share, current_price } = inputs
    const pricesValid =
      typeof buy_price_per_share === 'number'
      && Number.isFinite(buy_price_per_share)
      && buy_price_per_share > 0
      && typeof current_price === 'number'
      && Number.isFinite(current_price)
    if (!pricesValid) {
      return {
        status: 'cannot_size',
        reason:
          'conviction_use_discount_depth is ENABLED but buy_price_per_share/current_price is '
          + 'missing or non-finite — cannot size (fail-closed; not defaulted to 1.0).',
      }
    }
    const depth = (buy_price_per_share - current_price) / buy_price_per_share
    const { floor, full_at_depth } = params.conviction_discount_depth_ramp
    // Linear ramp from floor (at depth ≤ 0) to 1.0 (at depth ≥ full_at_depth), clamped to [floor, 1].
    const ramped = floor + (1 - floor) * (Math.max(0, depth) / full_at_depth)
    discount_depth_factor = Math.min(1, Math.max(floor, ramped))
  }

  const product =
    discount_depth_factor === undefined
      ? moat_factor * loss_uncertainty_factor
      : moat_factor * loss_uncertainty_factor * discount_depth_factor

  const factor = clamp01(product)
  const target_weight = params.base_target_weight * factor

  const components: ConvictionComponents = {
    moat_factor,
    permanent_loss_subfactor,
    uncertainty_subfactor,
    loss_uncertainty_factor,
    ...(discount_depth_factor === undefined ? {} : { discount_depth_factor }),
    product: factor,
  }

  const depthPart =
    discount_depth_factor === undefined
      ? 'discount_depth_factor=OFF (default — depth gates whether-to-buy, not how-much)'
      : `discount_depth_factor=${discount_depth_factor.toFixed(4)}`

  const reason =
    `conviction = moat_factor(${moat_class})=${moat_factor} × `
    + `[permanent_loss(${permanent_loss_level})=${permanent_loss_subfactor} × `
    + `uncertainty(${uncertainty_level})=${uncertainty_subfactor} = ${loss_uncertainty_factor}]`
    + `; ${depthPart}`
    + ` → product=${factor}; target_weight = base_target_weight(${params.base_target_weight}) × `
    + `${factor} = ${target_weight}.`

  return { status: 'ok', factor, target_weight, components, reason }
}
