import { VALUATION_PARAMS } from './valuationParams'

// ---------------------------------------------------------------------------------------------------
// Phase 4 (book alignment, owner-locked 2026-07-11): the book's valuation mechanics —
//   1. project current FREE CASH FLOW forward 10 years at the judged growth rate;
//   2. terminal value = year-10 FCF × the industry-typical P/FCF exit multiple (model-judged,
//      cite-labeled, harness-CLAMPED to [exit_multiple_min, exit_multiple_max], conservative
//      fallback when absent/ungrounded/invalid);
//   3. discount everything at the REQUIRED RETURN (flat 15% default, user setting);
//   4. sum the discounted cash flows;
//   5. adjust for net cash (+ cash & equivalents, − total debt);
//   6. margin of safety: buy at ≥30% below intrinsic value (rule 7); ≥50% = LOAD UP (rule 8).
// Pure arithmetic — "code computes, judgment proposes": the model judges growth + the exit multiple
// (both cited); every dollar figure here is deterministic.
// ---------------------------------------------------------------------------------------------------

export type ExitMultipleResolution = {
  multiple: number
  /** 'model_grounded' = cited + verified; 'model_asserted' = uncited/unverified (labeled, still
   *  used); 'fallback' = absent, invalid, or ABSURD (units/scale-error guard) → the conservative
   *  default. ('model_clamped' is a LEGACY value on historical payloads — the fixed band is retired;
   *  the reference is the model's own named comps, checked via comps_median below.) */
  source: 'model_grounded' | 'model_asserted' | 'fallback'
  /** Advisory self-consistency reads (owner rule: the band IS the named-comps set). */
  flags: string[]
}

/**
 * Resolve the exit multiple from the model's judged P/FCF. OWNER RULE (2026-07-12): no fixed clamp —
 * the book's 8–20× was an example, and each industry carries different multiples. The discipline is
 * the NAMED-COMPARABLES anchoring: when the model supplies structured comps, the harness checks the
 * chosen multiple against their MEDIAN (the conservative-tilt rule) and flags any excess. Only an
 * ABSURD value (units/scale error, outside [3, 40]) is discarded for the conservative fallback.
 */
export function resolveExitMultiple(args: {
  proposed?: number | undefined
  /** True when the model's citation verified against the corpus. */
  grounded: boolean
  /** Median P/FCF of the model's own named comps, when structured comps were supplied. */
  comps_median?: number | undefined
}): ExitMultipleResolution {
  const { proposed, grounded, comps_median } = args
  if (proposed === undefined || !Number.isFinite(proposed) || proposed <= 0) {
    return { multiple: VALUATION_PARAMS.exit_multiple_fallback, source: 'fallback', flags: [] }
  }
  if (proposed < VALUATION_PARAMS.exit_multiple_absurd_min || proposed > VALUATION_PARAMS.exit_multiple_absurd_max) {
    return {
      multiple: VALUATION_PARAMS.exit_multiple_fallback,
      source: 'fallback',
      flags: [`exit_multiple_absurd: the judged ${proposed}× is outside the [${VALUATION_PARAMS.exit_multiple_absurd_min}, ${VALUATION_PARAMS.exit_multiple_absurd_max}] units-error guard — discarded for the conservative ${VALUATION_PARAMS.exit_multiple_fallback}× fallback.`],
    }
  }
  const flags: string[] = []
  if (comps_median === undefined) {
    flags.push('exit_multiple_comps_unstructured: the model supplied no structured comps — the median self-consistency check is not computable; audit the basis note.')
  } else if (proposed > comps_median + 1e-9) {
    flags.push(`exit_multiple_above_comps_median: the chosen ${proposed}× EXCEEDS the median of the model's own named comps (${comps_median}×) — the conservative-tilt rule says at or below; audit the basis note.`)
  }
  return { multiple: proposed, source: grounded ? 'model_grounded' : 'model_asserted', flags }
}

export type FcfValuationResult = {
  /** Per-share intrinsic value after the net-cash adjustment. */
  intrinsic_value_per_share: number
  /** PV of the 10 explicit FCF years, per share. */
  pv_stage1_per_share: number
  /** PV of the terminal sale (FCF10 × exit multiple), per share. */
  pv_terminal_per_share: number
  /** Terminal share of the PRE-cash-adjustment value — the dominant-uncertainty flag input. */
  terminal_value_pct_of_iv: number
  /** (cash − debt) / shares — the book's step-5 adjustment (may be negative). */
  net_cash_per_share: number
}

/**
 * The book's intrinsic value, per share. All monetary inputs in $MILLIONS with shares in MILLIONS
 * (the adapter's scale — musd / m-shares = $/share). Returns undefined on non-positive FCF, shares,
 * or a required return that would not discount (fail-closed; the caller records the caveat).
 */
export function fcfIntrinsicValuePerShare(args: {
  /** Current annual free cash flow (CFO − capex), $M. */
  fcf_musd: number
  /** Judged annual growth (decimal) applied for the 10 explicit years. */
  growth: number
  /** The required annual return (decimal) — the discount rate. */
  required_return: number
  /** The resolved exit multiple (× year-10 FCF). */
  exit_multiple: number
  /** Cash & equivalents (+ short-term securities), $M. Absent → 0. */
  cash_musd?: number | undefined
  /** Total interest-bearing debt, $M. Absent → 0. */
  total_debt_musd?: number | undefined
  /** Diluted shares, MILLIONS. */
  shares_m: number
  /** Explicit horizon in years (the book: 10). */
  horizon?: number
}): FcfValuationResult | undefined {
  const { fcf_musd, growth, required_return, exit_multiple, shares_m } = args
  const horizon = args.horizon ?? 10
  if (!Number.isFinite(fcf_musd) || fcf_musd <= 0) return undefined
  if (!Number.isFinite(shares_m) || shares_m <= 0) return undefined
  if (!Number.isFinite(required_return) || required_return <= 0) return undefined
  if (!Number.isFinite(growth) || growth < 0) return undefined
  if (!Number.isFinite(exit_multiple) || exit_multiple <= 0) return undefined

  let pvStage1 = 0
  let fcfT = fcf_musd
  for (let t = 1; t <= horizon; t += 1) {
    fcfT = fcfT * (1 + growth)
    pvStage1 += fcfT / Math.pow(1 + required_return, t)
  }
  const pvTerminal = (fcfT * exit_multiple) / Math.pow(1 + required_return, horizon)
  const preCash = pvStage1 + pvTerminal
  const netCash = (args.cash_musd ?? 0) - (args.total_debt_musd ?? 0)
  const iv = preCash + netCash
  if (!Number.isFinite(iv) || iv <= 0) return undefined
  return {
    intrinsic_value_per_share: iv / shares_m,
    pv_stage1_per_share: pvStage1 / shares_m,
    pv_terminal_per_share: pvTerminal / shares_m,
    terminal_value_pct_of_iv: preCash > 0 ? pvTerminal / preCash : 0,
    net_cash_per_share: netCash / shares_m,
  }
}

// ---------------------------------------------------------------------------------------------------
// E2 (owner-locked 2026-07-12): OE is retired — the sanity lenses invert the SAME book model above.
// ---------------------------------------------------------------------------------------------------

/**
 * The growth TODAY'S price implies under the book model — the reverse solve of
 * {@link fcfIntrinsicValuePerShare} (monotone in g → bisection). Fails closed (undefined) on
 * unusable inputs or a price no growth in [-50%, +100%] explains.
 */
export function fcfImpliedGrowth(args: {
  price_per_share: number
  fcf_musd: number
  required_return: number
  exit_multiple: number
  cash_musd?: number | undefined
  total_debt_musd?: number | undefined
  shares_m: number
  horizon?: number
}): number | undefined {
  const { price_per_share, fcf_musd, required_return, exit_multiple, shares_m } = args
  const horizon = args.horizon ?? 10
  if (!Number.isFinite(price_per_share) || price_per_share <= 0) return undefined
  if (!Number.isFinite(fcf_musd) || fcf_musd <= 0) return undefined
  if (!Number.isFinite(shares_m) || shares_m <= 0) return undefined
  if (!Number.isFinite(required_return) || required_return <= 0) return undefined
  if (!Number.isFinite(exit_multiple) || exit_multiple <= 0) return undefined

  // IV at a given g, per share, allowing NEGATIVE growth (the forward function refuses g<0 by policy;
  // the reverse solve legitimately explores it — a price below today's-FCF value implies shrinkage).
  const ivAt = (g: number): number => {
    let pv = 0
    let fcfT = fcf_musd
    for (let t = 1; t <= horizon; t += 1) {
      fcfT = fcfT * (1 + g)
      pv += fcfT / Math.pow(1 + required_return, t)
    }
    const terminal = (fcfT * exit_multiple) / Math.pow(1 + required_return, horizon)
    return (pv + terminal + (args.cash_musd ?? 0) - (args.total_debt_musd ?? 0)) / shares_m
  }

  const G_LO = -0.5
  const G_HI = 1.0
  if (price_per_share <= ivAt(G_LO) || price_per_share >= ivAt(G_HI)) return undefined
  let lo = G_LO
  let hi = G_HI
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2
    if (ivAt(mid) < price_per_share) lo = mid
    else hi = mid
  }
  const g = (lo + hi) / 2
  return Number.isFinite(g) ? g : undefined
}

/**
 * The exit multiple TODAY'S price demands at the horizon, given the model's judged growth — solved
 * directly from the book model (price = PV(stage 1) + FCF_H × m / (1+r)^H + net cash). The caller
 * flags it when it exceeds the book band's ceiling. Fails closed on unusable inputs.
 */
export function fcfImpliedExitMultiple(args: {
  price_per_share: number
  fcf_musd: number
  growth: number
  required_return: number
  cash_musd?: number | undefined
  total_debt_musd?: number | undefined
  shares_m: number
  horizon?: number
}): number | undefined {
  const { price_per_share, fcf_musd, growth, required_return, shares_m } = args
  const horizon = args.horizon ?? 10
  if (!Number.isFinite(price_per_share) || price_per_share <= 0) return undefined
  if (!Number.isFinite(fcf_musd) || fcf_musd <= 0) return undefined
  if (!Number.isFinite(shares_m) || shares_m <= 0) return undefined
  if (!Number.isFinite(required_return) || required_return <= 0) return undefined
  if (!Number.isFinite(growth)) return undefined

  let pvStage1 = 0
  let fcfT = fcf_musd
  for (let t = 1; t <= horizon; t += 1) {
    fcfT = fcfT * (1 + growth)
    pvStage1 += fcfT / Math.pow(1 + required_return, t)
  }
  if (!(fcfT > 0)) return undefined
  const netCash = (args.cash_musd ?? 0) - (args.total_debt_musd ?? 0)
  const residual = price_per_share - (pvStage1 + netCash) / shares_m
  const m = (residual * shares_m * Math.pow(1 + required_return, horizon)) / fcfT
  return Number.isFinite(m) ? m : undefined
}
