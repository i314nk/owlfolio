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
  /** Interest-bearing debt, $millions (EDGAR total_debt). */
  interest_bearing_debt: number
  /** Cash + interest-bearing securities, $millions (EDGAR cash_and_securities). */
  cash_and_securities: number
  /** Total revenue, $millions (EDGAR revenue). */
  total_revenue: number
  /** Market cap, $millions (current price × diluted shares; spec wants 36-mo avg — see caller TODO). */
  market_cap: number
  /** Impermissible income, $millions — the LLM SHARIAH lane's JUDGMENT (interest income etc.). */
  impermissible_income: number
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

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
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

  // Denominators must be strictly positive; numerators must be non-negative finite values.
  if (!isPositiveFinite(market_cap)) {
    return { computable: false, reason: 'market_cap is missing or non-positive' }
  }
  if (!isPositiveFinite(total_revenue)) {
    return { computable: false, reason: 'total_revenue is missing or non-positive' }
  }
  if (!isNonNegativeFinite(interest_bearing_debt)) {
    return { computable: false, reason: 'interest_bearing_debt is missing or invalid' }
  }
  if (!isNonNegativeFinite(cash_and_securities)) {
    return { computable: false, reason: 'cash_and_securities is missing or invalid' }
  }
  if (!isNonNegativeFinite(impermissible_income)) {
    return { computable: false, reason: 'impermissible_income is missing or invalid' }
  }

  const debt_ratio = interest_bearing_debt / market_cap
  const cash_securities_ratio = cash_and_securities / market_cap
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
