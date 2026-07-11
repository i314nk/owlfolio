import { describe, expect, it } from 'vitest'
import { computePassiveDue, computeSplitDrift } from '../passiveSleeve'

// B7 (book alignment): rule-2 due arithmetic + the split-drift read (contributions at cost).

describe('computePassiveDue', () => {
  it('is due this month before the schedule day; overdue after it; satisfied once recorded', () => {
    const cfg = { schedule_day: 15 }
    expect(computePassiveDue(cfg, undefined, '2026-07-10')).toEqual({ next_due: '2026-07-15', overdue: false, contributed_this_month: false })
    expect(computePassiveDue(cfg, '2026-06-15', '2026-07-20')).toEqual({ next_due: '2026-07-15', overdue: true, contributed_this_month: false })
    expect(computePassiveDue(cfg, '2026-07-16', '2026-07-20')).toEqual({ next_due: '2026-08-15', overdue: false, contributed_this_month: true })
  })
  it('rolls the year at December', () => {
    expect(computePassiveDue({ schedule_day: 5 }, '2026-12-05', '2026-12-20').next_due).toBe('2027-01-05')
  })
})

describe('computeSplitDrift', () => {
  it('reads the actual split against the target with the drift sign (positive = passive-heavy)', () => {
    const d = computeSplitDrift({ split: '80/20', passive_total_contributed: 6000, active_value: 4000 })
    expect(d.target_passive_fraction).toBe(0.8)
    expect(d.actual_passive_fraction).toBeCloseTo(0.6, 6)
    expect(d.drift).toBeCloseTo(-0.2, 6)
    expect(d.basis_note).toMatch(/at cost/i)
  })
  it('is honest when nothing is recorded (no fabricated 0%)', () => {
    const d = computeSplitDrift({ split: '100/0', passive_total_contributed: 0, active_value: 0 })
    expect(d.actual_passive_fraction).toBeUndefined()
    expect(d.drift).toBeUndefined()
  })
})
