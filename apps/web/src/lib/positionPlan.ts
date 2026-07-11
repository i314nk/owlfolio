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
 * NOT a moat-tiered weight. Tranche STRUCTURE (the 40/30/30 entry ladder) is read from the strategy
 * contract's `entry_tranches` for display; the tranche $ amounts scale with the conviction target.
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

  // D2 (book alignment): with the rule-8 threshold present, the ladder anchors to the BOOK ZONES —
  // T1 arms at the 30%-margin buy threshold (rule 7), the last tranche at the 50% load-up threshold
  // (rule 8: "load up the truck"), intermediate tranches spaced evenly between the two zones.
  const loadUp = input.loadUpBelow !== undefined && input.loadUpBelow > 0 && input.loadUpBelow < buyPricePerShare
    ? input.loadUpBelow
    : undefined
  const trancheCount = strategy.portfolio.entry_tranches.length
  const tranches: PositionTranche[] = strategy.portfolio.entry_tranches.map((tranche, index) => {
    const id = tranche.id
    const trancheTargetValue = roundMoney(tranche.fraction * targetValue)
    const bookTrigger = loadUp !== undefined && trancheCount > 1
      ? roundMoney(buyPricePerShare - (index / (trancheCount - 1)) * (buyPricePerShare - loadUp))
      : undefined
    const triggerPrice = bookTrigger !== undefined
      ? bookTrigger
      : tranche.trigger === 'at_buy_price'
        ? buyPricePerShare
        : roundMoney(buyPricePerShare * (1 - tranche.pct))
    const triggerLabel = bookTrigger !== undefined
      ? index === 0
        ? 'rule 7 — at the 30% margin of safety'
        : index === trancheCount - 1
          ? 'rule 8 — load up the truck (50% margin)'
          : 'between the buy and load-up zones'
      : tranche.trigger === 'at_buy_price'
        ? 'at_buy_price'
        : `${Math.round(tranche.pct * 100)}% below buy price`
    const approxShares = triggerPrice > 0 ? Math.floor(trancheTargetValue / triggerPrice) : 0
    return {
      id,
      fraction: tranche.fraction,
      trigger_label: triggerLabel,
      trigger_price_per_share: triggerPrice,
      target_value: trancheTargetValue,
      approx_shares: approxShares,
      thesis_gate: id !== 'T1',
    }
  })

  const notes: string[] = [
    'Advisory draft — you author the actual buys; the worker never trades.',
    ...(loadUp !== undefined
      ? [
          'Book ladder: T1 arms at the rule 7 buy threshold (a 30% margin of safety, never less); the final tranche is the rule 8 zone — a 50% discount marks "load up the truck" conviction. Deployment and cluster caps still bind.',
        ]
      : []),
    'Tranches T2–T3 deploy only if the thesis is still intact (re-check on the price drop).',
    'Target weight is an entry cap — let winners run; do not force-trim a compounder.',
    `Respect the ${(cashBuffer * 100).toFixed(0)}% cash buffer and ${maxPositions}-position limit across the portfolio.`,
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
