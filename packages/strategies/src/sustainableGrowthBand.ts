import type { MoatClass, Runway, StrategyContract } from './strategyContract'

/**
 * Arguments for the grounded sustainable-growth band.
 *
 * ONE-KNOB DISCIPLINE (load-bearing): this type carries NO conservatism inputs — no terminal-value share,
 * no sensitivity-dispersion, no maintenance-capex confidence, no moat-durability haircut.
 * Conservatism lives in exactly one place — the required-growth-gap engine (a later slice) — not here.
 * This engine's job is to state, GROUNDED in economics, what growth the business can actually fund.
 */
export type SustainableGrowthBandArgs = {
  /** Incremental return on invested capital (fraction, e.g. 0.20). The economic engine of growth. */
  incremental_roic: number
  /** Fraction of owner earnings reinvested into the business (fraction, e.g. 0.50). */
  reinvestment_rate: number
  /**
   * Robust log-linear OE/share CAGR. A CROSS-CHECK input, NOT the driver: history that materially exceeds
   * the reinvestment×ROIC identity, with no cited capital-light basis, trips the grounding tripwire.
   */
  demonstrated_growth: number
  /** Reinvestment runway axis (proven/limited/none) — drives the honest dispersion of band_low. */
  runway: Runway
  /** Moat class — a wide/monopoly moat narrows the dispersion slightly (more durable). */
  moat_class: MoatClass
  /** Provenance of the incremental_roic figure — surfaced for human audit when model-proposed and uncited. */
  incremental_roic_basis: 'sec_edgar' | 'model_proposed'
  /**
   * The escape valve (sourced from the agent lane in a later slice): a CITED argument that the
   * reinvestment×ROIC identity understates a capital-light compounder (brand / network / operating-leverage
   * growth at low reinvestment — MSFT/GOOGL). Honoured ONLY when its citation is non-empty.
   */
  capital_light_argument?: { claimed_growth: number; citation: string }
}

/** Result of the grounded sustainable-growth band. */
export type SustainableGrowthBandResult = {
  /** Honest lower edge — uncertainty dispersion below the identity center (NOT a conservatism haircut). */
  band_low: number
  /** Honest upper edge — the identity (or a cited capital-light claim), capped by forecasting humility. */
  band_high: number
  /** The grounded anchor: g = reinvestment_rate × incremental_roic. */
  band_center: number
  /** Citations that GROUND the band: always the identity itself; the capital-light cite + cross-check when present. */
  basis_citations: string[]
  /** grounded | unsupported_high (history exceeds the identity, no cited basis) | not_computable (fail-closed). */
  grounding_status: 'grounded' | 'unsupported_high' | 'not_computable'
  /** Audit flags (capital-light escape used / capped, model-proposed-uncited, unsupported_high, not_computable). */
  flags: string[]
}

/**
 * Honest-dispersion spread factors for band_low (PROVISIONAL — to be CALIBRATED in V8). These are NOT a
 * conservatism knob: they widen the lower edge to reflect genuine uncertainty about how long the
 * reinvestment runway holds, NOT to deliberately understate value. A proven runway disperses least; a
 * non-existent runway disperses most. (See V8 calibration cohort before freezing these levels.)
 */
const RUNWAY_SPREAD_PROVISIONAL: Record<Runway, number> = {
  proven: 0.80,
  limited: 0.65,
  none: 0.45,
}

/** Slight narrowing for a more durable moat (honest dispersion — a wide/monopoly runway holds better). */
const DURABLE_MOAT_SPREAD_BONUS = 0.05
/** Ceiling on the spread factor (band_low never closer than this fraction below the center). */
const MAX_SPREAD = 0.90
/** Tolerance band on the demonstrated-vs-identity cross-check before tripping the grounding tripwire. */
const DEMONSTRATED_TOLERANCE = 0.10

/**
 * The GROUNDED sustainable-growth band (valuation-core revision).
 *
 * Anchors the band on the economic identity `g_fundamental = reinvestment_rate × incremental_roic` — the
 * growth a business can actually FUND from its own returns — rather than extrapolating past growth into a
 * precise point. The band is cited from economics, not asserted by an agent:
 *
 *   - band_center = g_fundamental (the identity).
 *   - band_high  = min(g_fundamental, single_growth_cap), UNLESS a cited capital-light argument lifts it
 *                  (still capped by the forward-forecasting-humility single_growth_cap). When history
 *                  implies more than the identity supports with no cited capital-light basis, band_high is
 *                  CLAMPED to the identity and grounding_status becomes 'unsupported_high' (the tripwire).
 *   - band_low   = g_fundamental × spread(runway, moat) — honest uncertainty dispersion, NOT a haircut.
 *
 * Carries NO conservatism inputs (one-knob discipline): conservatism lives in the required-gap engine.
 * `single_growth_cap` is read from the strategy contract at `strategy.valuation.single_growth_cap`.
 * Fail-closed: a non-finite or negative ROIC / reinvestment rate returns a zero band, 'not_computable'.
 */
export function sustainableGrowthBand(
  strategy: StrategyContract,
  args: SustainableGrowthBandArgs,
): SustainableGrowthBandResult {
  const cap = strategy.valuation.single_growth_cap

  // (1) Grounded anchor — fail closed on garbage inputs.
  if (
    !Number.isFinite(args.incremental_roic)
    || !Number.isFinite(args.reinvestment_rate)
    || args.incremental_roic < 0
    || args.reinvestment_rate < 0
  ) {
    return {
      band_low: 0,
      band_high: 0,
      band_center: 0,
      basis_citations: [],
      grounding_status: 'not_computable',
      flags: ['not_computable'],
    }
  }

  const gFundamental = args.reinvestment_rate * args.incremental_roic
  const flags: string[] = []
  const basis_citations: string[] = [
    `reinvestment ${(args.reinvestment_rate * 100).toFixed(0)}% × incremental ROIC `
    + `${(args.incremental_roic * 100).toFixed(0)}% = ${(gFundamental * 100).toFixed(1)}% sustainable `
    + `(basis: ${args.incremental_roic_basis})`,
  ]

  const hasCitedCapitalLight = args.capital_light_argument !== undefined
    && Number.isFinite(args.capital_light_argument.claimed_growth)
    && args.capital_light_argument.citation.trim().length > 0

  let grounding_status: SustainableGrowthBandResult['grounding_status'] = 'grounded'
  let band_high: number

  // (2) band_high — honest ceiling, bounded by forecasting humility (single_growth_cap).
  if (hasCitedCapitalLight) {
    // Escape valve: a cited capital-light argument may lift band_high above the identity (the
    // reinvestment×ROIC identity understates brand/network/operating-leverage compounders).
    const claimed = args.capital_light_argument!.claimed_growth
    band_high = Math.min(claimed, cap)
    flags.push('capital_light_escape_used')
    if (claimed > cap) {
      flags.push('capital_light_capped_by_growth_cap')
    }
    basis_citations.push(
      `capital-light escape valve: claimed ${(claimed * 100).toFixed(1)}% growth — `
      + `${args.capital_light_argument!.citation.trim()}`,
    )
  } else {
    band_high = Math.min(gFundamental, cap)
    // Grounding tripwire: history/agent implies more growth than the identity funds, with no cited
    // capital-light basis. Keep band_high clamped to the identity and flag it unsupported.
    if (args.demonstrated_growth > gFundamental * (1 + DEMONSTRATED_TOLERANCE)) {
      grounding_status = 'unsupported_high'
      flags.push(
        `unsupported_high: demonstrated ${(args.demonstrated_growth * 100).toFixed(1)}% exceeds `
        + `reinvestment(${(args.reinvestment_rate * 100).toFixed(0)}%)×incrementalROIC`
        + `(${(args.incremental_roic * 100).toFixed(0)}%)=${(gFundamental * 100).toFixed(1)}% — `
        + `clamped to the identity (no cited capital-light basis)`,
      )
    }
  }

  // Demonstrated-growth cross-check citation (always recorded — it is a cross-check, not the driver).
  basis_citations.push(
    `demonstrated OE/share CAGR cross-check: ${(args.demonstrated_growth * 100).toFixed(1)}% `
    + `(vs identity ${(gFundamental * 100).toFixed(1)}%)`,
  )

  // (3) band_low — honest uncertainty dispersion (NOT a haircut). PROVISIONAL spreads (V8 calibration).
  let spread = RUNWAY_SPREAD_PROVISIONAL[args.runway]
  if (args.moat_class === 'wide' || args.moat_class === 'monopoly') {
    spread = Math.min(MAX_SPREAD, spread + DURABLE_MOAT_SPREAD_BONUS)
  }
  let band_low = gFundamental * spread

  // (5) Provenance flag — a model-proposed ROIC underpins the IDENTITY (band_center), independent of any
  // capital-light citation (which justifies band_high, not the ROIC). Fire whenever the basis is model-proposed
  // so the grounding of the band's anchor is always surfaced for audit.
  if (args.incremental_roic_basis === 'model_proposed') {
    flags.push('incremental_roic_model_proposed_uncited')
  }

  // Enforce band_low ≤ band_center ≤ band_high (escape valve can push band_high above the center; an odd
  // input must never invert the ordering).
  const band_center = gFundamental
  if (band_high < band_center) band_high = band_center
  if (band_low > band_center) band_low = band_center

  return { band_low, band_high, band_center, basis_citations, grounding_status, flags }
}
