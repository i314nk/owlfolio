import type { AnnualFacts } from './secEdgar'

// ---------------------------------------------------------------------------------------------------
// Per-year ratio primitives over the EDGAR annual series — ONE source of truth shared by the moat
// anchor (judgmentAnchor), the three named moat tests (moatTests), and the management talent block.
// Extracted (S4) so moatTests and judgmentAnchor can depend on the same arithmetic without a cycle.
// ---------------------------------------------------------------------------------------------------

/** Assumed effective tax rate when a year's operating income/tax is missing (mirrors secEdgar). */
export const DEFAULT_TAX_RATE = 0.21

/** NOPAT proxy for a year: operating income x (1 - eff. tax); else NI + after-tax interest. */
export function nopatProxy(a: AnnualFacts): number | undefined {
  const op = a.operating_income_musd
  const tax = a.income_tax_expense_musd
  if (op !== undefined && Number.isFinite(op)) {
    let rate = DEFAULT_TAX_RATE
    if (tax !== undefined && Number.isFinite(tax) && op > 0) {
      const implied = tax / op
      if (implied >= 0 && implied <= 0.5) rate = implied
    }
    return op * (1 - rate)
  }
  const ni = a.net_income_musd
  if (ni !== undefined && Number.isFinite(ni)) {
    const interest = a.interest_expense_musd ?? 0
    return ni + (Number.isFinite(interest) ? interest * (1 - DEFAULT_TAX_RATE) : 0)
  }
  return undefined
}

/** Invested-capital proxy for a year: stockholders' equity + total debt − cash & securities. */
export function investedCapitalProxy(a: AnnualFacts): number | undefined {
  const equity = a.stockholders_equity_musd
  if (equity === undefined || !Number.isFinite(equity)) return undefined
  const debt = a.total_debt_musd ?? 0
  const cash = a.cash_and_securities_musd ?? 0
  return equity + (Number.isFinite(debt) ? debt : 0) - (Number.isFinite(cash) ? cash : 0)
}

/**
 * Per-year ROIC = NOPAT / invested capital. undefined when either proxy is missing/non-positive IC.
 * Shared: the capital-efficiency test, the anchor, and the management talent block all use THIS.
 */
export function yearRoic(a: AnnualFacts): number | undefined {
  const nopat = nopatProxy(a)
  const ic = investedCapitalProxy(a)
  if (nopat === undefined || ic === undefined || !(ic > 0)) return undefined
  return nopat / ic
}

/** Per-year operating margin = operating income / revenue. undefined when either is missing/<=0 rev. */
export function yearOperatingMargin(a: AnnualFacts): number | undefined {
  const op = a.operating_income_musd
  const rev = a.revenue_musd
  if (op === undefined || rev === undefined || !(rev > 0)) return undefined
  return op / rev
}

/** Per-year FREE CASH FLOW (the book's basis) = CFO − capex. undefined when either is missing. */
export function yearFcf(a: AnnualFacts): number | undefined {
  const cfo = a.cfo_musd
  const capex = a.capex_musd
  if (cfo === undefined || capex === undefined || !Number.isFinite(cfo) || !Number.isFinite(capex)) return undefined
  return cfo - capex
}

/** Per-year gross margin = gross profit / revenue. undefined when either is missing/<=0 rev. */
export function yearGrossMargin(a: AnnualFacts): number | undefined {
  const gp = a.gross_profit_musd
  const rev = a.revenue_musd
  if (gp === undefined || rev === undefined || !(rev > 0)) return undefined
  return gp / rev
}
