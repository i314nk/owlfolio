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
  buyPricePerShare: number
  investableCapital: number
  strategy?: StrategyContract
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

  const tranches: PositionTranche[] = strategy.portfolio.entry_tranches.map((tranche) => {
    const id = tranche.id
    const trancheTargetValue = roundMoney(tranche.fraction * targetValue)
    const triggerPrice = tranche.trigger === 'at_buy_price'
      ? buyPricePerShare
      : roundMoney(buyPricePerShare * (1 - tranche.pct))
    const triggerLabel = tranche.trigger === 'at_buy_price'
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
    'Tranches T2–T3 deploy only if the thesis is still intact (re-check on the price drop).',
    'Target weight is an entry cap — let winners run; do not force-trim a compounder.',
    `Respect the ${(cashBuffer * 100).toFixed(0)}% cash buffer and ${maxPositions}-position limit across the portfolio.`,
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
