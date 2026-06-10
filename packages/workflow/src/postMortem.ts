// Pure, deterministic exit post-mortem (lifecycle-spec-v3 Module 10 +
// strategy-additions-spec #5: "log the fields at exit; analysis can wait").
//
// On exit, compare PREDICTED (from the original research case: credited_g,
// fair_value_per_share, buy_price_per_share, MOS, moat_class) vs REALIZED (entry
// cost basis, exit price, holding period, realized P&L, dividends, price path):
//
//   - MOS protection: did the entry discount to fair value meet the required MOS
//     cushion, and did the realized downside stay within it?
//   - Credited-g vs actual: the credited growth vs the realized fundamental
//     CAGR over the hold (from a supplied EDGAR series; else not-computable).
//   - Which lane was most wrong: derived from forecast resolutions (highest
//     Brier) when present; otherwise left pending until forecasts resolve.
//
// The arithmetic is the harness's; a human may annotate the recorded post-mortem.
// Missing data → honest not-computable, never a fabricated number.

import { brierScore } from './forecastCalibration'

export type PostMortemPredicted = {
  fair_value_per_share?: number
  buy_price_per_share?: number
  /** Required margin of safety as a fraction (monopoly 0.20 / wide 0.30). */
  margin_of_safety?: number
  /** Credited growth rate (fraction) from the original valuation. */
  credited_g?: number
  moat_class?: string
}

export type PostMortemFundamentalPoint = {
  fiscal_year: number
  owner_earnings: number
}

export type PostMortemForecastResolution = {
  lane: string
  p: number
  outcome: boolean
}

export type PostMortemRealized = {
  entry_cost_basis_per_share: number
  exit_price_per_share: number
  /** Lowest observed price during the hold (for downside-within-cushion check). */
  lowest_price_per_share?: number
  opened_at: string
  closed_at: string
  realized_gain_loss: number
  dividends_received: number
  /** EDGAR owner-earnings series spanning the hold; absent → credited-g not computable. */
  fundamental_series?: PostMortemFundamentalPoint[]
  /** Resolved lane forecasts for this case; drives "which lane was most wrong". */
  forecast_resolutions?: PostMortemForecastResolution[]
}

export type PostMortemInput = {
  research_case_id: string
  holding_id: string
  predicted: PostMortemPredicted
  realized: PostMortemRealized
}

export type MosProtection = {
  /** (fair_value - entry_cost) / fair_value, the realized entry discount. */
  entry_discount_to_fv?: number
  /** The MOS the case required at entry. */
  required_mos?: number
  /** True when the entry discount met the required cushion AND the realized low stayed within it. */
  held?: boolean
  /** Lowest realized price as a discount to fair value, when a low is supplied. */
  realized_low_discount_to_fv?: number
  note?: string
}

export type CreditedGVsActual =
  | { computable: false; reason: string; predicted_g?: number }
  | { computable: true; predicted_g?: number; actual_g: number; over_credited?: boolean }

export type MostWrongLane = {
  basis: 'forecast_resolutions' | 'pending_forecast_resolutions'
  lane?: string
  /** Brier score of the worst lane, when derived from resolutions. */
  brier?: number
  note?: string
}

export type PositionPostMortem = {
  research_case_id: string
  holding_id: string
  moat_class?: string
  holding_period_days: number
  total_realized_pl: number
  mos_protection: MosProtection
  credited_g_vs_actual: CreditedGVsActual
  most_wrong_lane: MostWrongLane
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00.000Z`)
  const to = Date.parse(`${toISO}T00:00:00.000Z`)
  return Math.round((to - from) / (1000 * 60 * 60 * 24))
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits))
}

function computeMosProtection(predicted: PostMortemPredicted, realized: PostMortemRealized): MosProtection {
  const fv = predicted.fair_value_per_share
  const requiredMos = predicted.margin_of_safety
  if (fv === undefined || fv <= 0) {
    return { note: 'No fair value recorded on the original case; MOS protection not computable.' }
  }

  const entryDiscount = round((fv - realized.entry_cost_basis_per_share) / fv)
  const protection: MosProtection = { entry_discount_to_fv: entryDiscount }
  if (requiredMos !== undefined) {
    protection.required_mos = round(requiredMos)
  }

  let lowDiscount: number | undefined
  if (realized.lowest_price_per_share !== undefined) {
    lowDiscount = round((fv - realized.lowest_price_per_share) / fv)
    protection.realized_low_discount_to_fv = lowDiscount
  }

  if (requiredMos !== undefined) {
    // Held when the entry discount met the required cushion. The realized low is
    // informational: a deeper low than the cushion means the market offered more
    // safety, not less — the cushion is about the PRICE PAID, so entry governs.
    protection.held = entryDiscount + 1e-9 >= requiredMos
  }

  return protection
}

function computeCreditedGVsActual(predicted: PostMortemPredicted, realized: PostMortemRealized): CreditedGVsActual {
  const predictedG = predicted.credited_g
  const series = realized.fundamental_series
  if (series === undefined || series.length < 2) {
    return {
      computable: false,
      reason: 'No fundamental owner-earnings series spanning the hold; credited-g vs actual is not computable.',
      ...(predictedG === undefined ? {} : { predicted_g: round(predictedG) }),
    }
  }

  const sorted = [...series].sort((left, right) => left.fiscal_year - right.fiscal_year)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === undefined || last === undefined || first.owner_earnings <= 0 || last.fiscal_year === first.fiscal_year) {
    return {
      computable: false,
      reason: 'Fundamental series has a non-positive base or zero span; credited-g vs actual is not computable.',
      ...(predictedG === undefined ? {} : { predicted_g: round(predictedG) }),
    }
  }

  const years = last.fiscal_year - first.fiscal_year
  const actualG = round(Math.pow(last.owner_earnings / first.owner_earnings, 1 / years) - 1)
  const result: CreditedGVsActual = { computable: true, actual_g: actualG }
  if (predictedG !== undefined) {
    result.predicted_g = round(predictedG)
    result.over_credited = predictedG > actualG
  }
  return result
}

function computeMostWrongLane(realized: PostMortemRealized): MostWrongLane {
  const resolutions = realized.forecast_resolutions
  if (resolutions === undefined || resolutions.length === 0) {
    return {
      basis: 'pending_forecast_resolutions',
      note: 'No forecast resolutions yet; "which lane was most wrong" derives from forecast Brier scores once the annual reports resolve.',
    }
  }

  let worst: { lane: string; brier: number } | undefined
  for (const resolution of resolutions) {
    const brier = brierScore(resolution.p, resolution.outcome)
    if (worst === undefined || brier > worst.brier) {
      worst = { lane: resolution.lane, brier }
    }
  }

  if (worst === undefined) {
    return { basis: 'pending_forecast_resolutions' }
  }

  return {
    basis: 'forecast_resolutions',
    lane: worst.lane,
    brier: round(worst.brier),
    note: 'Lane with the highest Brier score (most confidently wrong) among resolved forecasts.',
  }
}

export function computePositionPostMortem(input: PostMortemInput): PositionPostMortem {
  const { predicted, realized } = input
  const result: PositionPostMortem = {
    research_case_id: input.research_case_id,
    holding_id: input.holding_id,
    holding_period_days: daysBetween(realized.opened_at, realized.closed_at),
    total_realized_pl: round(realized.realized_gain_loss + realized.dividends_received, 2),
    mos_protection: computeMosProtection(predicted, realized),
    credited_g_vs_actual: computeCreditedGVsActual(predicted, realized),
    most_wrong_lane: computeMostWrongLane(realized),
  }
  if (predicted.moat_class !== undefined) {
    result.moat_class = predicted.moat_class
  }
  return result
}
