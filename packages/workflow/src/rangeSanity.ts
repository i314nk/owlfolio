// Harness defense 3 (model-tiering-spec) — deterministic RANGE / SANITY checks on model-proposed
// numerics. "Proposed numbers checked by code (inc-ROIC > 100%? maintenance capex > revenue? →
// reject)." These run regardless of which model produced the number: a weaker model degrades into a
// VISIBLE rejected value + flag, never a silent garbage number fed into the valuation.
//
// Each check returns the SAFE value (the input when plausible; `undefined` = not-computable when
// rejected) plus a human-readable flag the caller surfaces in the dossier (mirroring the existing
// degraded_flags / valuation_caveats pattern). "If a component's output can be computed, compute it"
// — and if a proposed input is implausible, the harness rejects it deterministically rather than
// trusting the model's arithmetic.

/** Result of a sanity check: the safe value (undefined when rejected) + a visible flag on rejection. */
export type SanityResult = {
  /** The plausible value, or `undefined` when rejected (caller falls back to a safe/not-computable path). */
  value: number | undefined
  /** true when the proposed value was implausible and rejected. */
  rejected: boolean
  /** A visible reason, set only on rejection — surfaced in the dossier (never silently dropped). */
  flag?: string
}

function pass(value: number): SanityResult {
  return { value, rejected: false }
}

function reject(flag: string): SanityResult {
  return { value: undefined, rejected: true, flag }
}

/**
 * ROIC / incremental-ROIC must be a finite fraction in [0, 1] (0–100%). inc-ROIC > 100% or negative is
 * implausible for a real business and signals a units/sign error — reject it (the valuation falls back
 * to the not-computable path rather than crediting fantasy growth). Spec example: inc-ROIC 1.5 → reject.
 */
export function sanitizeRoicLike(value: number, opts: { field: 'roic' | 'incremental_roic' }): SanityResult {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return reject(
      `range_check_rejected: ${opts.field}=${value} is outside the plausible [0, 1] band (>100% or negative `
      + `is implausible / a likely units error). Value discarded; not fed to the valuation.`,
    )
  }
  return pass(value)
}

/**
 * Maintenance capex (in $M) must be finite, non-negative, and NOT exceed revenue (a company cannot
 * sustainably spend more than its entire revenue maintaining the asset base). Spec example:
 * maintenance_capex > revenue → reject.
 */
export function sanitizeMaintenanceCapex(value: number, opts: { revenue: number }): SanityResult {
  if (!Number.isFinite(value) || value < 0) {
    return reject(`range_check_rejected: maintenance_capex=${value} is non-finite or negative. Value discarded.`)
  }
  if (Number.isFinite(opts.revenue) && value > opts.revenue) {
    return reject(
      `range_check_rejected: maintenance_capex=${value} exceeds revenue=${opts.revenue} — implausible `
      + `(a likely units/scale error). Value discarded; not fed to the valuation.`,
    )
  }
  return pass(value)
}

/** Shares outstanding (in millions) must be finite and strictly positive. */
export function sanitizeShares(value: number): SanityResult {
  if (!Number.isFinite(value) || value <= 0) {
    return reject(`range_check_rejected: shares_outstanding=${value} is non-finite or non-positive. Value discarded.`)
  }
  return pass(value)
}

/** Margin of safety must be a finite fraction in [0, 1]. */
export function sanitizeMarginOfSafety(value: number): SanityResult {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return reject(`range_check_rejected: margin_of_safety=${value} is outside [0, 1]. Value discarded.`)
  }
  return pass(value)
}

/** Reinvestment rate must be a finite fraction in [0, 2] (~200% allows a temporary build-out year). */
export function sanitizeReinvestmentRate(value: number): SanityResult {
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    return reject(`range_check_rejected: reinvestment_rate=${value} is outside the plausible [0, 2] band. Value discarded.`)
  }
  return pass(value)
}

/**
 * The model may propose a one-off NORMALIZATION to net income (buffett-valuation-method-v2 Step 2 — "use
 * the lower normalized base if current looks inflated"), but only as a BOUNDED delta off EDGAR's reported
 * figure: at most this fraction of |EDGAR reported NI|. A larger proposed swing is clamped to the band so
 * the EDGAR anchor — not the model — owns the figure. 0.35 = a generous one-off cleanup band without
 * letting the model void/restate the primary NI.
 */
export const OE_NORMALIZATION_MAX_FRACTION = 0.35

/**
 * Beyond THIS fraction off EDGAR's reported NI, a proposal is no longer a plausible one-off normalization
 * — it is a SCALE / CURRENCY / UNITS error (e.g. a DKK-reporting foreign filer whose NI the model
 * proposes in USD: Novo Nordisk EDGAR 102,434M DKK vs a model-proposed ~14,845, a ~7× gap). Such a
 * proposal carries no usable judgment, so the harness discards it and uses EDGAR's REPORTED figure
 * verbatim (the primary filing owns NI) rather than clamping to the normalization band edge — the old
 * clamp-to-edge left NI 35% off (102434×0.65=66,582.1) and failed a correct model on the gate. Must be
 * ≥ OE_NORMALIZATION_MAX_FRACTION (a gross mismatch is, by definition, beyond the honor band).
 */
export const OE_GROSS_MISMATCH_FRACTION = 0.6

/**
 * Anchor net income to EDGAR's reported figure. Three tiers, by how far the model's PROPOSED NI sits from
 * EDGAR's reported NI (as a fraction of |EDGAR reported NI|):
 *   - within ±OE_NORMALIZATION_MAX_FRACTION (≤35%)                 → HONOR the model's one-off normalization.
 *   - beyond the honor band but ≤ OE_GROSS_MISMATCH_FRACTION (60%) → CLAMP to the nearest band edge (an
 *     over-aggressive normalization; the EDGAR anchor caps how far the model may restate NI).
 *   - beyond OE_GROSS_MISMATCH_FRACTION, non-finite, or ≤ 0 while EDGAR is positive → treat as a
 *     SCALE/CURRENCY/UNITS error and fall back to EDGAR's REPORTED figure verbatim.
 * Returns the value the harness uses, whether it was adjusted (`clamped`), and a visible flag when it was.
 */
export function anchorNetIncomeToEdgar(
  proposed: number,
  edgarReported: number,
): { value: number; clamped: boolean; flag?: string } {
  // EDGAR figure must itself be finite to anchor against; otherwise the caller keeps the model path.
  if (!Number.isFinite(edgarReported)) {
    return { value: proposed, clamped: false }
  }
  const bound = OE_NORMALIZATION_MAX_FRACTION * Math.abs(edgarReported)
  const grossBound = OE_GROSS_MISMATCH_FRACTION * Math.abs(edgarReported)
  const lower = edgarReported - bound
  const upper = edgarReported + bound
  const deviation = Math.abs(proposed - edgarReported)
  // Scale/currency/units error (non-finite, ≤0 while EDGAR positive, or a gross >60% gap): no usable
  // normalization judgment — the primary filing owns NI, so use EDGAR's reported figure verbatim.
  if (!Number.isFinite(proposed) || (proposed <= 0 && edgarReported > 0) || deviation > grossBound) {
    return {
      value: edgarReported,
      clamped: true,
      flag:
        `oe_bridge_net_income_scale_mismatch: model proposed ${proposed} vs EDGAR reported ${edgarReported} `
        + `(used ${edgarReported}). The proposal is beyond a ±${OE_GROSS_MISMATCH_FRACTION * 100}% gross-mismatch `
        + `band — a likely scale/currency/units error (not a one-off normalization) — so the EDGAR-reported `
        + `figure is used verbatim.`,
    }
  }
  const clampFlag = (used: number): string =>
    `oe_bridge_net_income_clamped: model proposed ${proposed} vs EDGAR reported ${edgarReported} `
    + `(used ${used}). Net income is anchored to the EDGAR-reported figure with a bounded `
    + `±${OE_NORMALIZATION_MAX_FRACTION * 100}% normalization; the model's proposal exceeded that band.`
  // Over-aggressive (but not gross) normalization: clamp to the nearest band edge.
  if (proposed < lower) {
    return { value: lower, clamped: true, flag: clampFlag(lower) }
  }
  if (proposed > upper) {
    return { value: upper, clamped: true, flag: clampFlag(upper) }
  }
  // Within the band — the model's normalization is accepted as-is.
  return { value: proposed, clamped: false }
}

/**
 * The normalized working-capital change overlay (signed, $M) shouldn't dwarf the business: a magnitude
 * exceeding |revenue| is implausible (a likely units/scale error). Reject it (→ 0, no spurious OE swing)
 * with a visible flag. Sign is preserved when accepted (positive = use of cash, negative = release).
 */
export function sanitizeWorkingCapitalChange(value: number, opts: { revenue: number }): SanityResult {
  if (!Number.isFinite(value)) {
    return reject(`range_check_rejected: normalized_working_capital_change=${value} is non-finite. Value discarded (treated as 0).`)
  }
  if (Number.isFinite(opts.revenue) && Math.abs(value) > Math.abs(opts.revenue)) {
    return reject(
      `range_check_rejected: normalized_working_capital_change=${value} exceeds |revenue|=${opts.revenue} `
      + `in magnitude — implausible (a likely units/scale error). Value discarded (treated as 0).`,
    )
  }
  return pass(value)
}

/** Terminal / credited growth g must be a finite fraction in [0, 0.05] (the 5% absolute cap). */
export function sanitizeTerminalGrowth(value: number): SanityResult {
  if (!Number.isFinite(value) || value < 0 || value > 0.05) {
    return reject(`range_check_rejected: growth g=${value} is outside the plausible [0, 0.05] band. Value discarded.`)
  }
  return pass(value)
}
