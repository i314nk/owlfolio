import type { MoatClass, StrategyContract } from './strategyContract'
import { moatPassesGate } from './buffettMunger'

export type PositionPlanInput = {
  strategy: StrategyContract
  moatClass: MoatClass
  buyPricePerShare: number
  investableCapital: number
  currency?: string
}

export type PositionTranche = {
  id: 'T1' | 'T2' | 'T3'
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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Computes a deterministic, advisory position plan for the given input.
 *
 * This is ADVISORY ONLY — it never executes trades, triggers orders, or opens holdings.
 * The user authors all actual buys. The worker never trades.
 *
 * Logic:
 * - If the moat class does not pass the gate → investable: false, no tranches.
 * - target_weight = target_weight_by_moat[moatClass], clamped ≤ max_position_weight.
 * - target_value = round(target_weight × investableCapital, 2).
 * - Tranches from entry_tranches: T1 at buy price; T2/T3 at buy × (1 − pct).
 * - thesis_gate = true for T2 and T3 (require thesis re-check before deploying).
 */
export function computePositionPlan(input: PositionPlanInput): PositionPlan {
  const { strategy, moatClass, buyPricePerShare, investableCapital } = input

  const cashBuffer = strategy.portfolio.cash_buffer_minimum
  const maxPositions = strategy.portfolio.max_positions
  const maxPositionWeight = strategy.portfolio.max_position_weight

  if (!moatPassesGate(strategy, moatClass)) {
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

  // target_weight_by_moat is typed as { wide: number; monopoly: number } — safe cast
  const weightsByMoat = strategy.portfolio.target_weight_by_moat as Record<string, number>
  const rawWeight = weightsByMoat[moatClass] ?? 0
  const targetWeight = Math.min(rawWeight, maxPositionWeight)
  const targetValue = roundMoney(targetWeight * investableCapital)

  const tranches: PositionTranche[] = []

  for (const tranche of strategy.portfolio.entry_tranches) {
    const id = tranche.id as 'T1' | 'T2' | 'T3'
    const trancheTargetValue = roundMoney(tranche.fraction * targetValue)
    let triggerPrice: number
    let triggerLabel: string

    if (tranche.trigger === 'at_buy_price') {
      triggerPrice = buyPricePerShare
      triggerLabel = 'at_buy_price'
    } else {
      // pct_below_buy_price
      triggerPrice = roundMoney(buyPricePerShare * (1 - tranche.pct))
      triggerLabel = `${Math.round(tranche.pct * 100)}% below buy price`
    }

    const approxShares = triggerPrice > 0 ? Math.floor(trancheTargetValue / triggerPrice) : 0
    const thesisGate = id !== 'T1'

    tranches.push({
      id,
      fraction: tranche.fraction,
      trigger_label: triggerLabel,
      trigger_price_per_share: triggerPrice,
      target_value: trancheTargetValue,
      approx_shares: approxShares,
      thesis_gate: thesisGate,
    })
  }

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
