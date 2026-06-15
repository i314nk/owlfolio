import { describe, expect, it } from 'vitest'

import {
  applyMinimumHoldGuard,
  type GuardDecision,
  type ImpairmentCall,
  type MinimumHoldTrigger,
} from '../minimumHoldGuard'

// ---------------------------------------------------------------------------
// Phase 6 S2 — the minimum-hold GUARD. It brakes LOSS sales inside the 2–3yr window, but it does NOT
// invent its own clock-based test: it CONSUMES the shared fixable-vs-permanent judgment (impairment_call,
// produced by the admit/heldImpairment layer) so a genuinely broken thesis fires THROUGH the guard while
// loss-driven impatience is braked. There is NO age-only / clock-only release path here: the only ways to
// reach release_through_guard are (thesis_broke + permanent_impairment) or original_mistake, both inside
// the window AND at a loss. On the impairment-driven thesis_broke path, `unresolved` must NEVER silently
// route to hold_blocks_sell — it escalates (the Horsehead trap). (better_opportunity is switching
// discipline, not impairment, so it blocks unconditionally — see that test.)
// ---------------------------------------------------------------------------

const ALL_TRIGGERS: readonly MinimumHoldTrigger[] = [
  'thesis_broke',
  'valuation_inverted',
  'better_opportunity',
  'original_mistake',
]
const ALL_CALLS: readonly ImpairmentCall[] = [
  'fixable_temporary',
  'permanent_impairment',
  'unresolved',
]

describe('applyMinimumHoldGuard — pre-gate (the guard only brakes LOSS sales inside the window)', () => {
  it('NOT at a loss → inactive for EVERY trigger (a valuation-inverted gain is the important case)', () => {
    for (const trigger of ALL_TRIGGERS) {
      for (const impairment_call of ALL_CALLS) {
        const result = applyMinimumHoldGuard({
          trigger,
          impairment_call,
          at_loss: false,
          within_window: true,
        })
        expect(result.decision).toBe<GuardDecision>('inactive')
      }
    }
  })

  it('out of window (within_window false) → inactive for EVERY trigger', () => {
    for (const trigger of ALL_TRIGGERS) {
      for (const impairment_call of ALL_CALLS) {
        const result = applyMinimumHoldGuard({
          trigger,
          impairment_call,
          at_loss: true,
          within_window: false,
        })
        expect(result.decision).toBe<GuardDecision>('inactive')
      }
    }
  })
})

describe('applyMinimumHoldGuard — in-window at-loss per-trigger × impairment_call matrix', () => {
  const inWindowAtLoss = { at_loss: true, within_window: true } as const

  it('original_mistake → release_through_guard regardless of impairment_call', () => {
    for (const impairment_call of ALL_CALLS) {
      const result = applyMinimumHoldGuard({ trigger: 'original_mistake', impairment_call, ...inWindowAtLoss })
      expect(result.decision).toBe<GuardDecision>('release_through_guard')
    }
  })

  it('thesis_broke + permanent_impairment → release_through_guard (broken thesis fires through)', () => {
    const result = applyMinimumHoldGuard({
      trigger: 'thesis_broke',
      impairment_call: 'permanent_impairment',
      ...inWindowAtLoss,
    })
    expect(result.decision).toBe<GuardDecision>('release_through_guard')
  })

  it('thesis_broke + fixable_temporary → hold_blocks_sell (the disposition brake)', () => {
    const result = applyMinimumHoldGuard({
      trigger: 'thesis_broke',
      impairment_call: 'fixable_temporary',
      ...inWindowAtLoss,
    })
    expect(result.decision).toBe<GuardDecision>('hold_blocks_sell')
  })

  it('thesis_broke + unresolved → escalate_human_review (and NOT hold_blocks_sell — the Horsehead trap)', () => {
    const result = applyMinimumHoldGuard({
      trigger: 'thesis_broke',
      impairment_call: 'unresolved',
      ...inWindowAtLoss,
    })
    expect(result.decision).toBe<GuardDecision>('escalate_human_review')
    expect(result.decision).not.toBe<GuardDecision>('hold_blocks_sell')
  })

  it('better_opportunity → hold_blocks_sell UNCONDITIONALLY (the anti-churn brake, incl. unresolved)', () => {
    // better_opportunity is switching discipline, not an impairment judgment: blocking a loss-making
    // switch inside the window does NOT trap you in a real impairment (if the holding were impaired, that
    // is the thesis_broke channel, which releases). So the anti-churn brake binds for EVERY impairment_call,
    // including `unresolved` — escalating here would be a churn loophole (leave impairment unresolved to
    // convert a should-be-blocked switch into an approvable escalation). The unresolved→escalate rule is
    // scoped to the impairment-judgment-driven thesis_broke path, not to switching discipline.
    for (const impairment_call of ALL_CALLS) {
      const result = applyMinimumHoldGuard({ trigger: 'better_opportunity', impairment_call, ...inWindowAtLoss })
      expect(result.decision).toBe<GuardDecision>('hold_blocks_sell')
    }
  })

  it('valuation_inverted in-window-at-loss → escalate_human_review (incoherent: inverted means a gain)', () => {
    for (const impairment_call of ALL_CALLS) {
      const result = applyMinimumHoldGuard({ trigger: 'valuation_inverted', impairment_call, ...inWindowAtLoss })
      expect(result.decision).toBe<GuardDecision>('escalate_human_review')
    }
  })
})

describe('applyMinimumHoldGuard — structural no-parallel-clock invariants (full cross product)', () => {
  it('exhaustive cross product upholds the release / window / unresolved invariants', () => {
    for (const trigger of ALL_TRIGGERS) {
      for (const impairment_call of ALL_CALLS) {
        for (const within_window of [true, false]) {
          for (const at_loss of [true, false]) {
            const { decision } = applyMinimumHoldGuard({ trigger, impairment_call, at_loss, within_window })

            // (a) every release is exactly one of the two allowed combinations, each requiring
            // within_window && at_loss.
            if (decision === 'release_through_guard') {
              expect(within_window && at_loss).toBe(true)
              const allowed =
                (trigger === 'thesis_broke' && impairment_call === 'permanent_impairment')
                || trigger === 'original_mistake'
              expect(allowed).toBe(true)
            }

            // (b) nothing out of window ever releases.
            if (within_window === false) {
              expect(decision).not.toBe<GuardDecision>('release_through_guard')
            }

            // (c) on the impairment-judgment-driven path (thesis_broke), an unresolved judgment never
            // yields hold_blocks_sell — it escalates (the Horsehead trap). This is scoped to thesis_broke:
            // better_opportunity is switching discipline (not impairment), so it blocks unconditionally.
            if (trigger === 'thesis_broke' && impairment_call === 'unresolved' && within_window && at_loss) {
              expect(decision).toBe<GuardDecision>('escalate_human_review')
            }
          }
        }
      }
    }
  })
})
