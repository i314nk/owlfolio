import { describe, expect, it } from 'vitest'

import { SIZING_PARAMS, type SizingParams } from '@owlfolio/strategies/sizingParams'

import {
  suggestLadder,
  confirmLadderForPosition,
  computeTrancheLevels,
  reanchorTrancheLevels,
  computeDeployedPct,
  evaluateSizingTranche,
  type SizingCaseStatus,
  type SizingPositionStatus,
} from '../positionSizingEngine'

// position-sizing-spec §8 acceptance tests + supporting unit coverage. Every parameter is read from
// SIZING_PARAMS (no constant in logic) — acceptance #7 mutates the config and asserts behaviour changes.

const COLD_CASE = (over: Partial<SizingCaseStatus> = {}): SizingCaseStatus => ({
  buy_price: 100,
  buy_price_version: 'v1',
  thesis_break_unresolved: false,
  stale: false,
  recheck_clean: true,
  ...over,
})

const COLD_POS = (over: Partial<SizingPositionStatus> = {}): SizingPositionStatus => ({
  ladder_id: 'cold',
  filled_tranche_ids: ['T1'],
  ...over,
})

describe('suggestLadder — temperature hook (deferred input, defaulted)', () => {
  it('returns cold when temperature ≥ threshold+1 (≥8)', () => {
    expect(suggestLadder(8)).toBe('cold')
    expect(suggestLadder(10)).toBe('cold')
  })
  it('returns normal when temperature ≤ threshold (≤7)', () => {
    expect(suggestLadder(7)).toBe('normal')
    expect(suggestLadder(5)).toBe('normal')
  })
  it('DEFAULTS to the configured default ladder (normal) when temperature is absent (deferred overlay)', () => {
    expect(suggestLadder()).toBe(SIZING_PARAMS.default_ladder)
    expect(suggestLadder(undefined)).toBe('normal')
  })
})

describe('acceptance #4 — temperature 5 at T1 → normal 60/40, then immutable', () => {
  it('suggests normal, fixes it on the position, and later evaluations use the SAME ladder', () => {
    const suggested = suggestLadder(5)
    expect(suggested).toBe('normal')

    // Human confirms at T1.
    const confirmed = confirmLadderForPosition({ confirmed_ladder_id: suggested, temperature: 5 })
    expect(confirmed.ladder_id).toBe('normal')
    expect(confirmed.immutable).toBe(true)

    // Later, even if the temperature swings to a cold reading, the position keeps its confirmed ladder.
    const later = confirmLadderForPosition({ existing_ladder_id: confirmed.ladder_id, temperature: 9 })
    expect(later.ladder_id).toBe('normal')
    expect(later.immutable).toBe(true)

    // The normal ladder is 60/40 two-tranche.
    const levels = computeTrancheLevels(100, 'normal', 'v1')
    expect(levels.map((l) => l.id)).toEqual(['T1', 'T2'])
    expect(levels.map((l) => l.fraction)).toEqual([0.60, 0.40])
  })
})

describe('computeTrancheLevels — price levels per rung', () => {
  it('cold ladder: T1 @ buy, T2 @ buy×0.90, T3 @ buy×0.80, tagged with the buy_price_version', () => {
    const levels = computeTrancheLevels(100, 'cold', 'v3')
    expect(levels).toEqual([
      { id: 'T1', fraction: 0.40, trigger_price: 100, buy_price_version: 'v3' },
      { id: 'T2', fraction: 0.30, trigger_price: 90, buy_price_version: 'v3' },
      { id: 'T3', fraction: 0.30, trigger_price: 80, buy_price_version: 'v3' },
    ])
  })
})

describe('acceptance #1 — re-check lowers FV 15% → untriggered levels move down, new buy_price_version', () => {
  it('re-anchors untriggered T2/T3 to the new buy price and tags the new version', () => {
    // Original buy 100; T1 filled. Re-check lowers buy 15% → 85.
    const reanchored = reanchorTrancheLevels({
      new_buy_price: 85,
      ladder_id: 'cold',
      new_buy_price_version: 'v2',
      filled_tranche_ids: ['T1'],
    })
    // T1 (filled) is excluded; T2/T3 re-anchored to 85.
    expect(reanchored.map((l) => l.id)).toEqual(['T2', 'T3'])
    expect(reanchored.find((l) => l.id === 'T2')?.trigger_price).toBe(76.5) // 85 × 0.90
    expect(reanchored.find((l) => l.id === 'T3')?.trigger_price).toBe(68) // 85 × 0.80
    expect(reanchored.every((l) => l.buy_price_version === 'v2')).toBe(true)

    // The alert computes against the NEW version: at price 76, T2 fires against buy 85 (not stale 100).
    const alert = evaluateSizingTranche({
      case_status: COLD_CASE({ buy_price: 85, buy_price_version: 'v2' }),
      position: COLD_POS({ filled_tranche_ids: ['T1'] }),
      current_price: 76,
    })
    expect(alert.alert).toBe(true)
    expect(alert.tranche_id).toBe('T2')
    expect(alert.trigger_type).toBe('price')
    expect(alert.buy_price_version).toBe('v2')
    expect(alert.trigger_price).toBe(76.5)
  })
})

describe('acceptance #2 — 2% below buy for 6 months + clean re-check → T2 time_completion', () => {
  it('fires the next tranche with trigger_type=time_completion at the prevailing price', () => {
    const alert = evaluateSizingTranche({
      case_status: COLD_CASE({ buy_price: 100, recheck_clean: true }),
      position: COLD_POS({ filled_tranche_ids: ['T1'], months_since_last_fill: 6 }),
      current_price: 98, // 2% below buy, above the −10% T2 price level (90) → not a price trigger
    })
    expect(alert.alert).toBe(true)
    expect(alert.tranche_id).toBe('T2')
    expect(alert.trigger_type).toBe('time_completion')
  })

  it('does NOT fire time-completion when the most recent re-check is not clean', () => {
    const alert = evaluateSizingTranche({
      case_status: COLD_CASE({ buy_price: 100, recheck_clean: false }),
      position: COLD_POS({ filled_tranche_ids: ['T1'], months_since_last_fill: 6 }),
      current_price: 98,
    })
    expect(alert.alert).toBe(false)
  })

  it('does NOT fire time-completion before N months elapse', () => {
    const alert = evaluateSizingTranche({
      case_status: COLD_CASE({ buy_price: 100 }),
      position: COLD_POS({ filled_tranche_ids: ['T1'], months_since_last_fill: 5 }),
      current_price: 98,
    })
    expect(alert.alert).toBe(false)
  })
})

describe('acceptance #3 — thesis-break unresolved + price hits T3 → NO alert (blocked, logged)', () => {
  it('blocks regardless of price and logs the reason', () => {
    const alert = evaluateSizingTranche({
      case_status: COLD_CASE({ buy_price: 100, thesis_break_unresolved: true }),
      position: COLD_POS({ filled_tranche_ids: ['T1', 'T2'] }),
      current_price: 80, // at the T3 −20% level
    })
    expect(alert.alert).toBe(false)
    expect(alert.blocked).toBe(true)
    expect(alert.block_reason).toBe('thesis_break_unresolved')
    expect(alert.message).toMatch(/thesis-break/i)
  })
})

describe('acceptance #5 (sleeve-deferred) — single-name 15% cap reached → cap-review, no aggregation', () => {
  it('flags the next tranche for cap-review when the position is at/over the per-name cap', () => {
    const alert = evaluateSizingTranche({
      case_status: COLD_CASE({ buy_price: 100 }),
      position: COLD_POS({ filled_tranche_ids: ['T1', 'T2'], current_weight: 0.15 }),
      current_price: 80, // would otherwise trigger T3 by price
    })
    expect(alert.alert).toBe(false)
    expect(alert.blocked).toBe(true)
    expect(alert.block_reason).toBe('per_name_cap_reached')
  })
})

describe('acceptance #6 — stale case at T2 price → re-run forced before alert', () => {
  it('blocks with rerun_needed and no alert until re-run', () => {
    const alert = evaluateSizingTranche({
      case_status: COLD_CASE({ buy_price: 100, stale: true, stale_reason: 'case older than 12 months' }),
      position: COLD_POS({ filled_tranche_ids: ['T1'] }),
      current_price: 90, // at the T2 −10% level
    })
    expect(alert.alert).toBe(false)
    expect(alert.blocked).toBe(true)
    expect(alert.block_reason).toBe('stale_case')
    expect(alert.rerun_needed).toBe(true)
  })
})

describe('acceptance #7 — all params read from config (mutating config changes behaviour)', () => {
  it('changing time_completion_months from 6 to 3 changes the time-completion outcome with no code change', () => {
    const customParams: SizingParams = {
      ...SIZING_PARAMS,
      time_completion_months: 3,
    }
    // 4 months at/below buy, clean re-check: default (6) → no fire; custom (3) → fires.
    const args = {
      case_status: COLD_CASE({ buy_price: 100 }),
      position: COLD_POS({ filled_tranche_ids: ['T1'], months_since_last_fill: 4 }),
      current_price: 98,
    }
    expect(evaluateSizingTranche(args).alert).toBe(false)
    expect(evaluateSizingTranche({ ...args, params: customParams }).alert).toBe(true)
    expect(evaluateSizingTranche({ ...args, params: customParams }).trigger_type).toBe('time_completion')
  })

  it('changing a ladder fraction changes the deployed-% computation with no code change', () => {
    const customParams: SizingParams = {
      ...SIZING_PARAMS,
      ladders: {
        ...SIZING_PARAMS.ladders,
        cold: {
          rungs: [
            { id: 'T1', fraction: 0.50, trigger: 'buy' },
            { id: 'T2', fraction: 0.30, trigger: 'minus_10' },
            { id: 'T3', fraction: 0.20, trigger: 'minus_20' },
          ],
        },
      },
    }
    expect(computeDeployedPct('cold', ['T1'])).toBe(0.40)
    expect(computeDeployedPct('cold', ['T1'], customParams)).toBe(0.50)
  })
})

describe('deployment ratio — deployed % vs target (spec §5.5)', () => {
  it('sums filled rung fractions vs 1.0', () => {
    expect(computeDeployedPct('cold', [])).toBe(0)
    expect(computeDeployedPct('cold', ['T1'])).toBe(0.40)
    expect(computeDeployedPct('cold', ['T1', 'T2'])).toBe(0.70)
    expect(computeDeployedPct('cold', ['T1', 'T2', 'T3'])).toBe(1)
    expect(computeDeployedPct('normal', ['T1'])).toBe(0.60)
    expect(computeDeployedPct('normal', ['T1', 'T2'])).toBe(1)
  })
})
