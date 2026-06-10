// Pure, deterministic discipline reports (lifecycle-spec-v3 Module 8):
//   - Discount-at-purchase vs subsequent outcome — calibrates whether the MOS
//     levels are right over time (entry discount to fair value vs realized
//     1yr / since outcome).
//   - Gate-override attempts — a real integrity check: any case where a BUY was
//     authored despite a FAILING hard gate. Expected to be ZERO; surface the
//     count (0 = green).
//   - Thesis-review latency — time from a thesis-break / staleness trigger to the
//     review or re-run.
//
// These are arithmetic + structured records. Missing data → honest absence, never
// a fabricated number.

export type DisciplineHoldingInput = {
  holding_id: string
  ticker?: string
  fair_value_per_share?: number
  buy_price_per_share?: number
  entry_cost_basis_per_share: number
  /** Price ~1 year after entry, when available. */
  one_year_price_per_share?: number
  /** Latest known price (for the since-entry outcome). */
  latest_price_per_share?: number
}

export type GateOverrideCheckInput = {
  research_case_id: string
  ticker?: string
  /** The authored verdict (BUY / WATCH / PASS). */
  investment_verdict?: string
  /** Hard gates that FAILED on this case (a non-empty set on a BUY is a violation). */
  failing_hard_gates: string[]
}

export type ThesisReviewLatencyInput = {
  holding_id: string
  ticker?: string
  /** When a thesis-break / staleness trigger fired. */
  triggered_at: string
  /** When the review / re-run was authored; absent → still open. */
  reviewed_at?: string
}

export type DisciplineReportsInput = {
  holdings: DisciplineHoldingInput[]
  cases: GateOverrideCheckInput[]
  thesisReviewLatencies?: ThesisReviewLatencyInput[]
}

export type DiscountAtPurchaseRow = {
  holding_id: string
  ticker?: string
  /** (fair_value - entry_cost) / fair_value. */
  entry_discount_to_fv?: number
  /** Entry cost as a discount to the buy price (positive = bought below buy price). */
  entry_discount_to_buy_price?: number
  /** (one_year_price - entry_cost) / entry_cost, when a 1yr price exists. */
  one_year_outcome?: number
  /** (latest_price - entry_cost) / entry_cost, when a latest price exists. */
  since_outcome?: number
}

export type GateOverrideViolation = {
  research_case_id: string
  ticker?: string
  failing_hard_gates: string[]
}

export type GateOverrideReport = {
  /** Count of BUY verdicts authored despite a failing hard gate. Expected 0. */
  count: number
  /** True when count === 0. */
  integrity_ok: boolean
  violations: GateOverrideViolation[]
}

export type ThesisReviewLatencyRow = {
  holding_id: string
  ticker?: string
  triggered_at: string
  reviewed_at?: string
  resolved: boolean
  /** Days from trigger to review, when resolved. */
  latency_days?: number
}

export type DisciplineReports = {
  discount_at_purchase: DiscountAtPurchaseRow[]
  gate_override: GateOverrideReport
  thesis_review_latency: ThesisReviewLatencyRow[]
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits))
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00.000Z`)
  const to = Date.parse(`${toISO}T00:00:00.000Z`)
  return Math.round((to - from) / (1000 * 60 * 60 * 24))
}

function buildDiscountAtPurchase(holdings: DisciplineHoldingInput[]): DiscountAtPurchaseRow[] {
  return holdings.map((holding) => {
    const row: DiscountAtPurchaseRow = { holding_id: holding.holding_id }
    if (holding.ticker !== undefined) row.ticker = holding.ticker

    if (holding.fair_value_per_share !== undefined && holding.fair_value_per_share > 0) {
      row.entry_discount_to_fv = round((holding.fair_value_per_share - holding.entry_cost_basis_per_share) / holding.fair_value_per_share)
    }
    if (holding.buy_price_per_share !== undefined && holding.buy_price_per_share > 0) {
      row.entry_discount_to_buy_price = round((holding.buy_price_per_share - holding.entry_cost_basis_per_share) / holding.buy_price_per_share)
    }
    if (holding.entry_cost_basis_per_share > 0) {
      if (holding.one_year_price_per_share !== undefined) {
        row.one_year_outcome = round((holding.one_year_price_per_share - holding.entry_cost_basis_per_share) / holding.entry_cost_basis_per_share)
      }
      if (holding.latest_price_per_share !== undefined) {
        row.since_outcome = round((holding.latest_price_per_share - holding.entry_cost_basis_per_share) / holding.entry_cost_basis_per_share)
      }
    }
    return row
  })
}

function buildGateOverrideReport(cases: GateOverrideCheckInput[]): GateOverrideReport {
  const violations: GateOverrideViolation[] = []
  for (const candidate of cases) {
    const isBuy = (candidate.investment_verdict ?? '').toUpperCase() === 'BUY'
    if (isBuy && candidate.failing_hard_gates.length > 0) {
      const violation: GateOverrideViolation = {
        research_case_id: candidate.research_case_id,
        failing_hard_gates: candidate.failing_hard_gates,
      }
      if (candidate.ticker !== undefined) violation.ticker = candidate.ticker
      violations.push(violation)
    }
  }
  return {
    count: violations.length,
    integrity_ok: violations.length === 0,
    violations,
  }
}

function buildThesisReviewLatency(inputs: ThesisReviewLatencyInput[] | undefined): ThesisReviewLatencyRow[] {
  if (inputs === undefined) return []
  return inputs.map((input) => {
    const row: ThesisReviewLatencyRow = {
      holding_id: input.holding_id,
      triggered_at: input.triggered_at,
      resolved: input.reviewed_at !== undefined,
    }
    if (input.ticker !== undefined) row.ticker = input.ticker
    if (input.reviewed_at !== undefined) {
      row.reviewed_at = input.reviewed_at
      row.latency_days = daysBetween(input.triggered_at, input.reviewed_at)
    }
    return row
  })
}

export function computeDisciplineReports(input: DisciplineReportsInput): DisciplineReports {
  return {
    discount_at_purchase: buildDiscountAtPurchase(input.holdings),
    gate_override: buildGateOverrideReport(input.cases),
    thesis_review_latency: buildThesisReviewLatency(input.thesisReviewLatencies),
  }
}
