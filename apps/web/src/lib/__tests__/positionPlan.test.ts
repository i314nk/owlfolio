import { describe, expect, it } from 'vitest'

import { buildPositionPlan } from '../positionPlan'

// ---------------------------------------------------------------------------------------------------
// D2 (owner feedback, post-B8): the position plan reads the FOUR PILLARS and the book's zones.
//  - Pillar gates: a case that failed the front gate / circle / moat / management veto is NOT sizeable,
//    and the note NAMES the failed pillar (front gate first, then P1 → P2 → P3).
//  - Book ladder: with load_up_below present the tranche triggers anchor to the book zones — T1 at the
//    30%-margin buy threshold (rule 7), T2 midway, T3 at the 50% load-up threshold (rule 8, "load up
//    the truck"). Fractions still come from the strategy contract; T2/T3 stay thesis-gated.
//  - Legacy input (no zones/pillars) keeps today's pct-below-buy ladder — old dossiers still size.
// ---------------------------------------------------------------------------------------------------

const PASSING_PILLARS = { shariah_pass: true, in_circle: true, moat_passes_gate: true, management_vetoed: false }

describe('buildPositionPlan — pillar gates (D2)', () => {
  const base = { moatClass: 'wide' as const, buyPricePerShare: 205.09, investableCapital: 100_000, loadUpBelow: 146.5 }

  it('sizes a case whose four pillars pass', () => {
    const plan = buildPositionPlan({ ...base, pillars: PASSING_PILLARS })
    expect(plan.investable).toBe(true)
  })

  it.each([
    [{ ...PASSING_PILLARS, shariah_pass: false }, /front gate/i],
    [{ ...PASSING_PILLARS, in_circle: false }, /pillar 1/i],
    [{ ...PASSING_PILLARS, moat_passes_gate: false }, /pillar 2/i],
    [{ ...PASSING_PILLARS, management_vetoed: true }, /pillar 3/i],
  ])('refuses to size when a pillar fails and NAMES it: %o', (pillars, namePattern) => {
    const plan = buildPositionPlan({ ...base, pillars })
    expect(plan.investable).toBe(false)
    expect(plan.tranches).toHaveLength(0)
    expect(plan.notes.join(' ')).toMatch(namePattern)
  })

  it('names the FIRST failed pillar in checklist order (front gate before management)', () => {
    const plan = buildPositionPlan({ ...base, pillars: { shariah_pass: false, in_circle: true, moat_passes_gate: true, management_vetoed: true } })
    expect(plan.notes.join(' ')).toMatch(/front gate/i)
    expect(plan.notes.join(' ')).not.toMatch(/pillar 3/i)
  })
})

describe('buildPositionPlan — book zone ladder (D2)', () => {
  it('anchors the tranche triggers to the book zones: rule 7 at buy, midway, rule 8 at load-up', () => {
    const plan = buildPositionPlan({
      moatClass: 'wide', buyPricePerShare: 200, investableCapital: 100_000,
      loadUpBelow: 100, pillars: PASSING_PILLARS,
    })
    expect(plan.investable).toBe(true)
    expect(plan.tranches.map((t) => t.id)).toEqual(['T1', 'T2', 'T3'])
    expect(plan.tranches[0]?.trigger_price_per_share).toBe(200)
    expect(plan.tranches[0]?.trigger_label).toMatch(/rule 7/i)
    expect(plan.tranches[1]?.trigger_price_per_share).toBe(150) // midway between the zones
    expect(plan.tranches[2]?.trigger_price_per_share).toBe(100)
    expect(plan.tranches[2]?.trigger_label).toMatch(/rule 8/i)
    expect(plan.tranches[2]?.trigger_label.toLowerCase()).toContain('load up the truck')
    // Fractions still come from the strategy contract; T2/T3 stay thesis-gated.
    expect(plan.tranches.map((t) => t.fraction)).toEqual([0.40, 0.30, 0.30])
    expect(plan.tranches.map((t) => t.thesis_gate)).toEqual([false, true, true])
    // The notes speak the book rules.
    const notes = plan.notes.join(' ')
    expect(notes).toMatch(/rule 7/i)
    expect(notes).toMatch(/rule 8/i)
  })

  it('keeps the legacy pct-below-buy ladder when no zones/pillars are provided (old dossiers still size)', () => {
    const plan = buildPositionPlan({ moatClass: 'wide', buyPricePerShare: 300, investableCapital: 100_000 })
    expect(plan.investable).toBe(true)
    expect(plan.tranches[0]?.trigger_label).toBe('at_buy_price')
    expect(plan.tranches[1]?.trigger_label).toBe('10% below buy price')
    expect(plan.tranches[2]?.trigger_price_per_share).toBe(240)
  })

  it('still refuses a below-gate moat class (backstop even without pillar inputs)', () => {
    const plan = buildPositionPlan({ moatClass: 'moderate', buyPricePerShare: 100, investableCapital: 50_000 })
    expect(plan.investable).toBe(false)
  })
})
