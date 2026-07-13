// Advisory position-plan builder for the research-case panel.
//
// Phase 5 S6 (O-9 consolidation): this REPLACES the retired `computePositionPlan` (which read the
// moat-tiered `strategy.portfolio.target_weight_by_moat`). The target weight now comes from the S1
// conviction factor (`base_target_weight × conviction`, the surviving moat-tier-as-sizing-knob), NOT from
// a moat-tiered weight table. The no-tier intent does not survive in a second sizing surface.
//
// This is the DISPLAY plan only (advisory; the human authors every buy). The deep-dive panel does not yet
// carry the admit-assessment risk levels, so the displayed conviction uses the deep-dive moat plus the
// neutral low/low risk default; the full S3/S4/S5 caps + worst-case are the S6 assembler
// (computeSizingRecommendation), wired into the live flow in S7.
//
// Pure + deterministic: no I/O. The caller supplies investable capital + the buy price.

import { computeConvictionFactor } from '@owlfolio/strategies/convictionFactor'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import type { MoatClass, StrategyContract } from '@owlfolio/strategies/strategyContract'

export type PositionTranche = {
  id: string
  fraction: number
  trigger_label: string
  trigger_price_per_share: number
  target_value: number
  approx_shares: number
  thesis_gate: boolean
}

export type PositionPlan = {
  investable: boolean
  moat_class: MoatClass
  target_weight: number
  target_value: number
  tranches: PositionTranche[]
  cash_buffer: number
  max_positions: number
  notes: string[]
}

const INVESTABLE_MOAT_CLASSES: ReadonlySet<string> = new Set(['wide', 'monopoly'])

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export type BuildPositionPlanInput = {
  moatClass: MoatClass
  /** The COMPUTED buy threshold (rule 7: intrinsic value less the 30% required margin). */
  buyPricePerShare: number
  investableCapital: number
  strategy?: StrategyContract
  /** D2 (book alignment): the rule-8 load-up threshold (IV × 0.50). Present → the tranche ladder anchors to the book zones. */
  loadUpBelow?: number
  /** D2: the four-pillar outcomes. Present → a failed pillar refuses to size and is NAMED. Absent → legacy behavior. */
  pillars?: {
    shariah_pass: boolean
    in_circle: boolean
    moat_passes_gate: boolean
    management_vetoed: boolean
  }
}

/** The first failed pillar in checklist order, or undefined when all pass. */
function firstFailedPillar(pillars: NonNullable<BuildPositionPlanInput['pillars']>): string | undefined {
  if (!pillars.shariah_pass) return 'the front gate (Shariah) — non-compliant names are not sizeable'
  if (!pillars.in_circle) return 'Pillar 1 (circle of competence) — outside the circle is a pass, not a position'
  if (!pillars.moat_passes_gate) return 'Pillar 2 (moat) — below the investability gate'
  if (pillars.management_vetoed) return 'Pillar 3 (management) — the integrity/talent veto stands'
  return undefined
}

/**
 * Build the advisory display plan. The target weight is the S1 conviction target
 * (`base_target_weight × conviction_factor`) for the deep-dive moat (neutral low/low risk default) —
 * NOT a moat-tiered weight. OWNER-LOCKED (2026-07-13): the 40/30/30 entry ladder is RETIRED — the
 * book prescribes two ZONES (rule 7 buy / rule 8 load-up); each row is the cumulative target there.
 */
export function buildPositionPlan(input: BuildPositionPlanInput): PositionPlan {
  const strategy = input.strategy ?? buffettMungerStrategy
  const { moatClass, buyPricePerShare, investableCapital } = input

  const cashBuffer = strategy.portfolio.cash_buffer_minimum
  const maxPositions = strategy.portfolio.max_positions

  // D2: the four pillars gate the plan — a failed pillar refuses to size and NAMES itself (checklist order).
  const failedPillar = input.pillars !== undefined ? firstFailedPillar(input.pillars) : undefined
  if (failedPillar !== undefined) {
    return {
      investable: false,
      moat_class: moatClass,
      target_weight: 0,
      target_value: 0,
      tranches: [],
      cash_buffer: cashBuffer,
      max_positions: maxPositions,
      notes: [`Not sizeable — failed at ${failedPillar}.`],
    }
  }

  if (!INVESTABLE_MOAT_CLASSES.has(moatClass)) {
    return {
      investable: false,
      moat_class: moatClass,
      target_weight: 0,
      target_value: 0,
      tranches: [],
      cash_buffer: cashBuffer,
      max_positions: maxPositions,
      notes: ['Below the wide-moat gate — not sizeable.'],
    }
  }

  // Target weight from S1 conviction (the surviving moat-tier-as-sizing-knob), neutral low/low risk for
  // the display panel. S7 wires the real admit-assessment risk levels + the full caps.
  const conviction = computeConvictionFactor({
    moat_class: moatClass,
    permanent_loss_level: 'low',
    uncertainty_level: 'low',
  })
  // RULE 8 (owner-locked 2026-07-13): the load-up zone's bolder target — the truck base × the same
  // conviction factor. Shown as the second zone row's target so the plan reads as the book: buy in
  // the zone; when the discount is deep, act boldly.
  const truckConviction = computeConvictionFactor({
    moat_class: moatClass,
    permanent_loss_level: 'low',
    uncertainty_level: 'low',
    in_load_up_zone: true,
  })
  if (conviction.status === 'cannot_size') {
    return {
      investable: false,
      moat_class: moatClass,
      target_weight: 0,
      target_value: 0,
      tranches: [],
      cash_buffer: cashBuffer,
      max_positions: maxPositions,
      notes: ['Not sizeable — conviction could not be computed for this moat.'],
    }
  }

  const targetWeight = conviction.target_weight
  const targetValue = roundMoney(targetWeight * investableCapital)
  const truckWeight = truckConviction.status === 'ok' ? truckConviction.target_weight : targetWeight
  const truckValue = roundMoney(truckWeight * investableCapital)

  // OWNER-LOCKED (2026-07-13, the book verbatim): no staged ladder — the book prescribes TWO ZONES,
  // not tranches. "Rule 8: Once you find a margin of safety, load up the truck" / "act boldly".
  // Zone 1 (rule 7): in the buy zone (≥30% margin) build the conviction target. Zone 2 (rule 8):
  // at a ≥50% margin the target rises to the truck weight. Each row shows the CUMULATIVE target at
  // that zone; adding on the way down stays thesis-gated (a falling price is re-checked, not chased).
  const loadUp = input.loadUpBelow !== undefined && input.loadUpBelow > 0 && input.loadUpBelow < buyPricePerShare
    ? input.loadUpBelow
    : undefined
  const zoneRow = (id: string, label: string, price: number, value: number, weight: number, gated: boolean): PositionTranche => ({
    id,
    fraction: weight,
    trigger_label: label,
    trigger_price_per_share: roundMoney(price),
    target_value: value,
    approx_shares: price > 0 ? Math.floor(value / price) : 0,
    thesis_gate: gated,
  })
  const tranches: PositionTranche[] = [
    zoneRow('BUY_ZONE', 'rule 7 — the buy zone (a ≥30% margin of safety, never less)', buyPricePerShare, targetValue, targetWeight, false),
    ...(loadUp !== undefined
      ? [zoneRow('LOAD_UP', 'rule 8 — load up the truck (a ≥50% margin: act boldly)', loadUp, truckValue, truckWeight, true)]
      : []),
  ]

  const notes: string[] = [
    'Advisory draft — you author the actual buys; the worker never trades.',
    ...(loadUp !== undefined
      ? [
          'The book gives two ZONES, not a ladder: build the conviction target in the buy zone (rule 7); at a ≥50% margin the target rises to the truck weight (rule 8 — "once you find a margin of safety, load up the truck"). Deployment and cluster caps still bind.',
        ]
      : []),
    'Adding on the way down is thesis-gated — a falling price is re-checked, never chased.',
    'Target weight is an entry cap — let winners run; do not force-trim a compounder.',
    `The ${(cashBuffer * 100).toFixed(0)}% cash buffer and ${maxPositions}-position limit are OUR risk rails — the book prescribes zones and boldness, not counts or weights.`,
    // S6 follow-up (i): this bare conviction target is NOT fully risk-checked. The downside caps
    // (permanent-loss / cluster / deployment hurdle) are applied at EXECUTION-TIME sizing — the on-demand
    // sizing recommendation (S7) — which leads with the concrete worst case and may cut this target or
    // park the capital in savings. Read this weight as the conviction ceiling, not the final size.
    'This is the conviction target only — NOT fully risk-checked. The permanent-loss, cluster, and deployment-hurdle caps are applied at execution-time sizing (the on-demand sizing recommendation), which leads with the worst case and may cut this number or hold in savings.',
  ]

  return {
    investable: true,
    moat_class: moatClass,
    target_weight: targetWeight,
    target_value: targetValue,
    tranches,
    cash_buffer: cashBuffer,
    max_positions: maxPositions,
    notes,
  }
}
