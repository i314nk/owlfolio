// AAOIFI-style Shariah FINANCIAL-ratio layer — deterministic, harness-computed.
//
// "Judgment proposes, code computes": the SHARIAH lane (LLM) confirms the sector status and
// identifies the IMPERMISSIBLE income amount (interest income, non-permissible segment revenue).
// This pure function then recomputes the three AAOIFI financial ratios + verdict + purification %
// from EDGAR primary data + market cap — re-verifying the model rather than trusting its arithmetic.
//
// The SECTOR verdict (e.g. conventional banking, alcohol) is a SEPARATE hard stop handled by the
// caller; this layer only covers the balance-sheet/income financial screen.
//
// AAOIFI thresholds (buffett-pipeline-spec-v2 Lane 5):
//   interest-bearing debt / market cap          < 30%
//   (cash + interest-bearing securities) / mktcap < 30%
//   impermissible income / total revenue        < 5%
//
// All monetary inputs are in the same currency unit (Owlfolio convention: $MILLIONS).

/** Interest-bearing debt / market cap must stay below this. */
export const AAOIFI_DEBT_RATIO_MAX = 0.3
/** (Cash + interest-bearing securities) / market cap must stay below this. */
export const AAOIFI_CASH_SECURITIES_RATIO_MAX = 0.3
/** Impermissible income / total revenue must stay below this. */
export const AAOIFI_IMPERMISSIBLE_INCOME_MAX = 0.05

export type ShariahFinancialRatioInputs = {
  /**
   * Interest-bearing debt, $millions (EDGAR total_debt). MISSING (`undefined`) is treated as 0 — a
   * company with no reported interest-bearing debt legitimately has a 0% debt ratio. An explicit
   * non-finite value (NaN) is a data-corruption signal and is rejected.
   *
   * FLAW-FAMILY NOTE (vs impermissible_income below): treating a MISSING debt/cash figure as 0 is
   * defensible HERE because the EDGAR harness extracts total_debt / cash_and_securities STRUCTURALLY
   * from the balance sheet — an absent value means the line is genuinely zero/near-zero, not "the
   * model failed to find it". impermissible_income is the OPPOSITE: it is a MODEL JUDGMENT (interest
   * income / prohibited-segment revenue the LLM reads out of the filing), so a missing value means
   * "could not extract", and defaulting it to 0 fails OPEN (a falsely-clean 0% purification). That is
   * why impermissible_income carries an explicit `null` undetermined state and is fail-CLOSED below,
   * while debt/cash keep the missing→0 convention.
   */
  interest_bearing_debt: number | undefined
  /** Cash + interest-bearing securities, $millions (EDGAR cash_and_securities). MISSING → 0 (see above). */
  cash_and_securities: number | undefined
  /** Total revenue, $millions (EDGAR revenue). REQUIRED — missing/zero → not-computable. */
  total_revenue: number | undefined
  /** Market cap, $millions (current price × diluted shares; spec wants 36-mo avg — see caller TODO). REQUIRED. */
  market_cap: number | undefined
  /**
   * Impermissible income, $millions — the LLM SHARIAH lane's JUDGMENT (interest income etc.).
   * `null` = UNDETERMINED: the filing does not separately disclose / the model could not extract a
   * quantified impermissible-income line. FAIL-CLOSED — undetermined must NEVER compute a 0% (a false
   * 0 produces a falsely-clean PASS / 0% purification); it returns computable:false so the caller
   * surfaces an UNDETERMINED verdict instead of a clean 0%. A genuine 0 the model affirmatively
   * verified is still a real value and computes normally.
   */
  impermissible_income: number | null
}

export type ShariahFinancialVerdict = 'PASS' | 'CONDITIONAL' | 'FAIL'

export type ShariahFinancialRatioResult =
  | {
      computable: true
      debt_ratio: number
      cash_securities_ratio: number
      impermissible_income_pct: number
      verdict: ShariahFinancialVerdict
      /** Carried into the purification engine (= impermissible_income_pct). */
      purification_pct: number
    }
  | {
      // Missing / divide-by-zero inputs: caller falls back to the lane's PROPOSED verdict.
      computable: false
      reason: string
    }

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/**
 * Compute the three AAOIFI financial ratios and the resulting verdict deterministically.
 *
 *   debt_ratio              = interest_bearing_debt / market_cap
 *   cash_securities_ratio   = cash_and_securities   / market_cap
 *   impermissible_income_pct = impermissible_income / total_revenue
 *
 *   verdict:
 *     FAIL        if any ratio breaches its threshold (>=)
 *     CONDITIONAL if all ratios are within threshold AND impermissible_income_pct > 0 (purify)
 *     PASS        otherwise (clean)
 *
 * Returns { computable: false } when a denominator is non-positive or any input is non-finite, so the
 * caller can fall back to the lane's proposed verdict instead of emitting a bogus ratio.
 */
export function computeShariahFinancialRatios(
  inputs: ShariahFinancialRatioInputs,
): ShariahFinancialRatioResult {
  const { interest_bearing_debt, cash_and_securities, total_revenue, market_cap, impermissible_income } = inputs

  // Only revenue + market cap are TRULY required (they are denominators). A missing debt / cash figure
  // is treated as 0 — a firm with no reported interest-bearing debt legitimately has a 0% debt ratio
  // (which passes the <30% AAOIFI threshold), NOT NaN → not-computable. An explicit non-finite value
  // (e.g. NaN injected upstream) is still rejected, as it signals corrupted data rather than "none".
  if (!isPositiveFinite(market_cap)) {
    return { computable: false, reason: 'market_cap is missing or non-positive' }
  }
  if (!isPositiveFinite(total_revenue)) {
    return { computable: false, reason: 'total_revenue is missing or non-positive' }
  }
  // Missing → 0; present-but-non-finite → reject.
  const debt = interest_bearing_debt === undefined ? 0 : interest_bearing_debt
  if (!isNonNegativeFinite(debt)) {
    return { computable: false, reason: 'interest_bearing_debt is invalid (non-finite)' }
  }
  const cash = cash_and_securities === undefined ? 0 : cash_and_securities
  if (!isNonNegativeFinite(cash)) {
    return { computable: false, reason: 'cash_and_securities is invalid (non-finite)' }
  }
  // FAIL-CLOSED on UNDETERMINED impermissible income. `null` = the SHARIAH lane could not extract /
  // the filing does not separately disclose a quantified impermissible-income line. We must NOT treat
  // that as 0 (which would compute a falsely-clean 0% purification / PASS — the compliance fail-OPEN);
  // instead it is not-computable so the caller surfaces an UNDETERMINED verdict. A genuine numeric 0
  // (the model affirmatively verified zero impermissible income) falls through and computes normally.
  if (impermissible_income === null) {
    return { computable: false, reason: 'impermissible_income undetermined' }
  }
  if (!isNonNegativeFinite(impermissible_income)) {
    return { computable: false, reason: 'impermissible_income is missing or invalid' }
  }

  const debt_ratio = debt / market_cap
  const cash_securities_ratio = cash / market_cap
  const impermissible_income_pct = impermissible_income / total_revenue

  const breaches =
    debt_ratio >= AAOIFI_DEBT_RATIO_MAX ||
    cash_securities_ratio >= AAOIFI_CASH_SECURITIES_RATIO_MAX ||
    impermissible_income_pct >= AAOIFI_IMPERMISSIBLE_INCOME_MAX

  let verdict: ShariahFinancialVerdict
  if (breaches) {
    verdict = 'FAIL'
  } else if (impermissible_income_pct > 0) {
    verdict = 'CONDITIONAL'
  } else {
    verdict = 'PASS'
  }

  return {
    computable: true,
    debt_ratio,
    cash_securities_ratio,
    impermissible_income_pct,
    verdict,
    // Purification % is carried for the purification engine regardless of verdict.
    purification_pct: impermissible_income_pct,
  }
}
