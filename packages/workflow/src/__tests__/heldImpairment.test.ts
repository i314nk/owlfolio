import { describe, expect, it } from 'vitest'

import { classifyAdmit } from '../admitJudgment'
import { reassessHeldImpairment } from '../heldImpairment'

// ---------------------------------------------------------------------------
// Phase 6 S1 — heldImpairment.reassessHeldImpairment is a THIN held-name entry point that re-runs the
// EXISTING admit fixable-vs-permanent judgment (classifyAdmit) on a held name's CURRENT facts. It must
// invent NO new judgment math: for any inputs it returns EXACTLY what classifyAdmit returns (delegation
// is identity). The reconciliation the whole phase depends on is that the minimum-hold guard reads the
// SAME impairment_call this produces, never a parallel clock-based test.
// ---------------------------------------------------------------------------

describe('reassessHeldImpairment — delegates to classifyAdmit (identity)', () => {
  it('returns fixable_temporary for low permanent-loss + passing quality (same as classifyAdmit)', () => {
    const args = { uncertainty: 'low', permanent_loss_risk: 'low', quality_verdict_passes: true } as const
    const result = reassessHeldImpairment(args)
    expect(result).toEqual(classifyAdmit(args))
    expect(result.impairment_call).toBe('fixable_temporary')
  })

  it('returns permanent_impairment for high permanent-loss even when quality passes (same as classifyAdmit)', () => {
    const args = { uncertainty: 'low', permanent_loss_risk: 'high', quality_verdict_passes: true } as const
    const result = reassessHeldImpairment(args)
    expect(result).toEqual(classifyAdmit(args))
    expect(result.impairment_call).toBe('permanent_impairment')
  })

  it('returns unresolved for medium permanent-loss (same as classifyAdmit)', () => {
    const args = { uncertainty: 'medium', permanent_loss_risk: 'medium', quality_verdict_passes: true } as const
    const result = reassessHeldImpairment(args)
    expect(result).toEqual(classifyAdmit(args))
    expect(result.impairment_call).toBe('unresolved')
  })

  it('returns unresolved when the quality verdict does not pass (same as classifyAdmit)', () => {
    const args = { uncertainty: 'low', permanent_loss_risk: 'low', quality_verdict_passes: false } as const
    const result = reassessHeldImpairment(args)
    expect(result).toEqual(classifyAdmit(args))
    expect(result.impairment_call).toBe('unresolved')
  })
})
