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
 * figure: at most this fraction of |EDGAR reported NI|. A larger proposed swing (incl. a net_income of 0
 * while EDGAR is substantially positive) is clamped to the band so the EDGAR anchor — not the model — owns
 * the figure. 0.35 = a generous one-off cleanup band without letting the model void/restate the primary NI.
 */
export const OE_NORMALIZATION_MAX_FRACTION = 0.35

/**
 * Anchor net income to EDGAR's reported figure with a BOUNDED normalization. The model may PROPOSE a
 * normalized NI; we clamp the proposed delta to ±(OE_NORMALIZATION_MAX_FRACTION × |edgar_NI|). A proposed
 * value that is non-finite, ≤ 0 while EDGAR NI is substantially positive, or whose raw delta exceeds the
 * band is CLAMPED (or falls back to EDGAR reported when no sane delta is derivable) and flagged. Returns
 * the value the harness uses, whether it was clamped, and a visible flag when it was.
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
  const lower = edgarReported - bound
  const upper = edgarReported + bound
  const flag = (used: number): string =>
    `oe_bridge_net_income_clamped: model proposed ${proposed} vs EDGAR reported ${edgarReported} `
    + `(used ${used}). Net income is anchored to the EDGAR-reported figure with a bounded `
    + `±${OE_NORMALIZATION_MAX_FRACTION * 100}% normalization; the model's proposal exceeded that band.`
  // Implausible proposal (non-finite, or ≤ 0 while EDGAR is substantially positive): no sane delta is
  // derivable, so clamp to the nearest band edge (lower bound when EDGAR is positive).
  if (!Number.isFinite(proposed) || (proposed <= 0 && edgarReported > 0)) {
    const used = edgarReported > 0 ? lower : edgarReported
    return { value: used, clamped: true, flag: flag(used) }
  }
  if (proposed < lower) {
    return { value: lower, clamped: true, flag: flag(lower) }
  }
  if (proposed > upper) {
    return { value: upper, clamped: true, flag: flag(upper) }
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
