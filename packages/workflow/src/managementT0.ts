import type { AnnualFacts } from './secEdgar'
import { yearRoic } from './annualRatios'
import type { RetainedEarningsTestResult } from './retainedEarningsTest'

// ---------------------------------------------------------------------------------------------------
// S5 (Phase 3 pillars): the management TALENT T0 block — the owner's three talent criteria computed
// deterministically from the EDGAR series and INJECTED into the management lane as an observation
// block (like the insider block): (1) return on invested capital, (2) dividends & buybacks
// discipline, (3) debt management. The model reconciles with these numbers — it never re-derives
// them. Each sub-block fails closed independently ({ computable: false, reason }).
// ---------------------------------------------------------------------------------------------------

export const MIN_YEARS_FOR_TALENT_T0 = 5

export type ManagementTalentT0 = {
  roic:
    | { computable: true; median_roic: number; latest_roic: number; band: 'excellent' | 'solid' | 'weak'; years_used: number }
    | { computable: false; reason: string }
  payout:
    | {
        computable: true
        years_used: number
        dividend_paying_years: number
        buyback_years: number
        latest_dividends_musd?: number
        latest_buybacks_musd?: number
        latest_sbc_musd?: number
        /** Latest-year (dividends + buybacks) / net income, when NI > 0. */
        payout_ratio_latest?: number
        /** True when latest buybacks fail to cover latest SBC (repurchases only mop up dilution). */
        buybacks_below_sbc?: boolean
      }
    | { computable: false; reason: string }
  debt:
    | {
        computable: true
        latest_total_debt_musd: number
        net_debt_musd?: number
        /** Total debt / latest operating income (yrs of operating income to repay). */
        debt_to_operating_income?: number
        /** Operating income / interest expense. */
        interest_coverage?: number
      }
    | { computable: false; reason: string }
}

function window10(series: AnnualFacts[]): AnnualFacts[] {
  return [...series].sort((a, b) => b.fiscal_year - a.fiscal_year).slice(0, 10)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number)
}

/** Compute the talent T0 block. Pure; no I/O. */
export function computeManagementTalentT0(series: AnnualFacts[]): ManagementTalentT0 {
  const window = window10(series)
  const latest = window[0]

  // (1) ROIC — the same arithmetic as the capital-efficiency test (annualRatios.yearRoic).
  const roics = window
    .map((a) => ({ fy: a.fiscal_year, r: yearRoic(a) }))
    .filter((p): p is { fy: number; r: number } => p.r !== undefined && Number.isFinite(p.r))
  const roic: ManagementTalentT0['roic'] = roics.length >= MIN_YEARS_FOR_TALENT_T0
    ? (() => {
        const med = median(roics.map((p) => p.r))
        return {
          computable: true as const,
          median_roic: med,
          latest_roic: (roics[0] as { r: number }).r,
          band: med >= 0.15 ? ('excellent' as const) : med >= 0.1 ? ('solid' as const) : ('weak' as const),
          years_used: roics.length,
        }
      })()
    : { computable: false, reason: `needs >=${MIN_YEARS_FOR_TALENT_T0} usable ROIC years (have ${roics.length})` }

  // (2) Payout discipline — dividends & buybacks vs earnings and SBC.
  const payoutYears = window.filter((a) => a.net_income_musd !== undefined)
  let payout: ManagementTalentT0['payout']
  if (payoutYears.length >= MIN_YEARS_FOR_TALENT_T0 && latest !== undefined) {
    const dividendYears = payoutYears.filter((a) => (a.dividends_paid_musd ?? 0) > 0).length
    const buybackYears = payoutYears.filter((a) => (a.buybacks_musd ?? 0) > 0).length
    const latestDiv = latest.dividends_paid_musd
    const latestBb = latest.buybacks_musd
    const latestSbc = latest.sbc_musd
    const ni = latest.net_income_musd
    const payoutRatio = ni !== undefined && ni > 0 && (latestDiv !== undefined || latestBb !== undefined)
      ? ((latestDiv ?? 0) + (latestBb ?? 0)) / ni
      : undefined
    const buybacksBelowSbc = latestBb !== undefined && latestSbc !== undefined ? latestBb < latestSbc : undefined
    payout = {
      computable: true,
      years_used: payoutYears.length,
      dividend_paying_years: dividendYears,
      buyback_years: buybackYears,
      ...(latestDiv !== undefined ? { latest_dividends_musd: latestDiv } : {}),
      ...(latestBb !== undefined ? { latest_buybacks_musd: latestBb } : {}),
      ...(latestSbc !== undefined ? { latest_sbc_musd: latestSbc } : {}),
      ...(payoutRatio !== undefined ? { payout_ratio_latest: payoutRatio } : {}),
      ...(buybacksBelowSbc !== undefined ? { buybacks_below_sbc: buybacksBelowSbc } : {}),
    }
  } else {
    payout = { computable: false, reason: `needs >=${MIN_YEARS_FOR_TALENT_T0} years with net income (have ${payoutYears.length})` }
  }

  // (3) Debt management — level vs earnings power + coverage.
  let debt: ManagementTalentT0['debt']
  const latestDebt = latest?.total_debt_musd
  if (latest !== undefined && latestDebt !== undefined && Number.isFinite(latestDebt)) {
    const op = latest.operating_income_musd
    const interest = latest.interest_expense_musd
    const cash = latest.cash_and_securities_musd
    debt = {
      computable: true,
      latest_total_debt_musd: latestDebt,
      ...(cash !== undefined ? { net_debt_musd: latestDebt - cash } : {}),
      ...(op !== undefined && op > 0 ? { debt_to_operating_income: latestDebt / op } : {}),
      ...(op !== undefined && interest !== undefined && interest > 0 ? { interest_coverage: op / interest } : {}),
    }
  } else {
    debt = { computable: false, reason: 'total debt not tagged for the latest year' }
  }

  return { roic, payout, debt }
}

/**
 * Render the talent T0 + retained-earnings observation block injected into the management lane's
 * prompt (mirror of the insider block): the model RECONCILES with these harness numbers — its
 * talent judgment must engage them, never re-derive or contradict them silently.
 */
export function buildManagementTalentBlock(t0: ManagementTalentT0, retained?: RetainedEarningsTestResult): string {
  const lines: string[] = []
  lines.push('HARNESS-COMPUTED MANAGEMENT TALENT OBSERVATIONS (T0, from EDGAR — reconcile with these; do NOT re-derive):')
  lines.push(t0.roic.computable
    ? `- ROIC: median ${(t0.roic.median_roic * 100).toFixed(1)}% over ${t0.roic.years_used} yrs (latest ${(t0.roic.latest_roic * 100).toFixed(1)}%) — ${t0.roic.band}.`
    : `- ROIC: not computable (${t0.roic.reason}).`)
  lines.push(t0.payout.computable
    ? `- Payout discipline: dividends paid in ${t0.payout.dividend_paying_years}/${t0.payout.years_used} yrs, buybacks in ${t0.payout.buyback_years}/${t0.payout.years_used}`
      + `${t0.payout.latest_dividends_musd !== undefined ? `; latest dividends $${Math.round(t0.payout.latest_dividends_musd)}M` : ''}`
      + `${t0.payout.latest_buybacks_musd !== undefined ? `, buybacks $${Math.round(t0.payout.latest_buybacks_musd)}M` : ''}`
      + `${t0.payout.payout_ratio_latest !== undefined ? `, payout ratio ${(t0.payout.payout_ratio_latest * 100).toFixed(0)}% of NI` : ''}`
      + `${t0.payout.buybacks_below_sbc === true ? ' — NOTE: buybacks below SBC (repurchases only mop up dilution)' : ''}.`
    : `- Payout discipline: not computable (${t0.payout.reason}).`)
  lines.push(t0.debt.computable
    ? `- Debt management: total debt $${Math.round(t0.debt.latest_total_debt_musd)}M`
      + `${t0.debt.net_debt_musd !== undefined ? ` (net ${t0.debt.net_debt_musd < 0 ? '-$' + Math.abs(Math.round(t0.debt.net_debt_musd)) : '$' + Math.round(t0.debt.net_debt_musd)}M)` : ''}`
      + `${t0.debt.debt_to_operating_income !== undefined ? `, ${t0.debt.debt_to_operating_income.toFixed(1)}× operating income` : ''}`
      + `${t0.debt.interest_coverage !== undefined ? `, interest coverage ${t0.debt.interest_coverage.toFixed(0)}×` : ''}.`
    : `- Debt management: not computable (${t0.debt.reason}).`)
  if (retained !== undefined) {
    lines.push(retained.computable
      ? `- Retained-earnings test (Buffett): ${retained.passes ? 'PASSES' : 'FAILS'} — ${retained.note}`
      : `- Retained-earnings test (Buffett): deferred on data (${retained.reason}).`)
  }
  return lines.join('\n')
}
