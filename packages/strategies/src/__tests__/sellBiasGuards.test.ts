import { describe, expect, it } from 'vitest'

import {
  collectSellBiasCaveats,
  evaluateAnchoringGuard,
  evaluateDispositionGuard,
} from '../sellBiasGuards'

// ---------------------------------------------------------------------------
// Phase 6 S5 — Munger-style bias-hygiene guards (pure, deterministic, no I/O, no LLM).
//
// These ATTACH ADVISORY CAVEATS to a sell recommendation — they NEVER block or change the decision (the
// blocking brake is the separate minimum-hold guard, S2). They are seeds of the Phase-7 bias checklist.
//
//   - disposition effect: selling at a loss on a problem that is FIXABLE/TEMPORARY (loss-driven impatience).
//   - purchase-price anchoring: justifying a sell by reference to the COST BASIS, not intrinsic value.
//
// Each returns { caveat: SellBiasCaveat | null } — a caveat or no concern, NEVER a verdict.
// ---------------------------------------------------------------------------

describe('evaluateDispositionGuard', () => {
  it('flags a disposition caveat when at a loss on a fixable/temporary problem', () => {
    const result = evaluateDispositionGuard({
      at_loss: true,
      impairment_call: 'fixable_temporary',
    })
    expect(result.caveat).not.toBeNull()
    expect(result.caveat?.kind).toBe('disposition')
  })

  it('no caveat when the impairment is permanent (a clean impairment sell)', () => {
    const result = evaluateDispositionGuard({
      at_loss: true,
      impairment_call: 'permanent_impairment',
    })
    expect(result.caveat).toBeNull()
  })

  it('no caveat when not at a loss', () => {
    const result = evaluateDispositionGuard({
      at_loss: false,
      impairment_call: 'fixable_temporary',
    })
    expect(result.caveat).toBeNull()
  })

  it('no caveat when the impairment is unresolved (escalated to a human elsewhere)', () => {
    const result = evaluateDispositionGuard({
      at_loss: true,
      impairment_call: 'unresolved',
    })
    expect(result.caveat).toBeNull()
  })

  it('returns a caveat ONLY — never a decision/verdict field', () => {
    const result = evaluateDispositionGuard({
      at_loss: true,
      impairment_call: 'fixable_temporary',
    })
    expect(Object.keys(result)).toEqual(['caveat'])
    expect(result).not.toHaveProperty('decision')
    expect(result).not.toHaveProperty('verdict')
  })
})

describe('evaluateAnchoringGuard', () => {
  it('flags an anchoring caveat when the proposed basis is near cost rather than IV', () => {
    // cost 100, IV 160, proposed 105 — proposed hugs the cost basis.
    const result = evaluateAnchoringGuard({
      proposed_basis: 105,
      cost_basis_per_share: 100,
      frozen_iv: 160,
    })
    expect(result.caveat).not.toBeNull()
    expect(result.caveat?.kind).toBe('anchoring')
  })

  it('no caveat when the proposed basis sits near intrinsic value', () => {
    // cost 100, IV 160, proposed 155 — proposed leans on IV, not cost.
    const result = evaluateAnchoringGuard({
      proposed_basis: 155,
      cost_basis_per_share: 100,
      frozen_iv: 160,
    })
    expect(result.caveat).toBeNull()
  })

  it('no caveat when frozen_iv is undefined (cannot assess anchoring — fail-safe)', () => {
    const result = evaluateAnchoringGuard({
      proposed_basis: 105,
      cost_basis_per_share: 100,
      frozen_iv: undefined,
    })
    expect(result.caveat).toBeNull()
  })

  it('no caveat when frozen_iv is <= 0 (cannot assess anchoring — fail-safe)', () => {
    const result = evaluateAnchoringGuard({
      proposed_basis: 105,
      cost_basis_per_share: 100,
      frozen_iv: 0,
    })
    expect(result.caveat).toBeNull()
  })

  it('SAFETY PROPERTY SURVIVES: the anchoring guard STILL FIRES on the lighter freeze (frozen REFERENCE FV)', () => {
    // The scope-reframe dropped the frozen_band fields + the implied-vs-band sell trigger, but the
    // anchoring/disposition guard is a REAL safety property that MUST survive. It now anchors to the frozen
    // REFERENCE fair value (the renamed/repurposed frozen reference) — proving the don't-anchor-to-cost
    // caveat is NOT silently dropped when the band fields are removed. cost 100, frozen REFERENCE FV 160,
    // proposed 105 hugs cost → the caveat fires.
    const frozenReferenceFairValue = 160
    const result = evaluateAnchoringGuard({
      proposed_basis: 105,
      cost_basis_per_share: 100,
      frozen_iv: frozenReferenceFairValue,
    })
    expect(result.caveat).not.toBeNull()
    expect(result.caveat?.kind).toBe('anchoring')
  })

  it('no caveat when cost ≈ IV (indistinguishable) regardless of proposed basis', () => {
    // cost 100, IV 100.5 — cost and IV collapse onto each other; "near cost" is meaningless.
    const result = evaluateAnchoringGuard({
      proposed_basis: 100,
      cost_basis_per_share: 100,
      frozen_iv: 100.5,
    })
    expect(result.caveat).toBeNull()
  })

  it('returns a caveat ONLY — never a decision/verdict field', () => {
    const result = evaluateAnchoringGuard({
      proposed_basis: 105,
      cost_basis_per_share: 100,
      frozen_iv: 160,
    })
    expect(Object.keys(result)).toEqual(['caveat'])
    expect(result).not.toHaveProperty('decision')
    expect(result).not.toHaveProperty('verdict')
  })
})

describe('collectSellBiasCaveats', () => {
  it('collects both caveats when both biases are present', () => {
    const caveats = collectSellBiasCaveats({
      at_loss: true,
      impairment_call: 'fixable_temporary',
      proposed_basis: 105,
      cost_basis_per_share: 100,
      frozen_iv: 160,
    })
    expect(caveats.map((c) => c.kind).sort()).toEqual(['anchoring', 'disposition'])
  })

  it('returns an empty array when neither bias is present', () => {
    const caveats = collectSellBiasCaveats({
      at_loss: false,
      impairment_call: 'permanent_impairment',
      proposed_basis: 155,
      cost_basis_per_share: 100,
      frozen_iv: 160,
    })
    expect(caveats).toEqual([])
  })

  it('collects only the disposition caveat when only that bias is present', () => {
    const caveats = collectSellBiasCaveats({
      at_loss: true,
      impairment_call: 'fixable_temporary',
      proposed_basis: 155,
      cost_basis_per_share: 100,
      frozen_iv: 160,
    })
    expect(caveats.map((c) => c.kind)).toEqual(['disposition'])
  })
})
