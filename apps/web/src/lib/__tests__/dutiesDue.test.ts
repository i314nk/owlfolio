import { describe, expect, it } from 'vitest'

import { resolveDutiesDue, type DutiesDueInput } from '../dutiesDue'

function baseInput(overrides: Partial<DutiesDueInput> = {}): DutiesDueInput {
  return {
    now: new Date('2026-07-18T12:00:00.000Z'),
    automation: {
      discovery: { enabled: true, cadence: 'weekly', auto_research: false },
      thesis_review: { enabled: true, cadence: 'quarterly' },
    } as DutiesDueInput['automation'],
    tasks: [],
    decided_case_count: 3,
    open_holding_count: 1,
    ...overrides,
  }
}

describe('resolveDutiesDue — the command-center duty nudges (owner, 2026-07-18)', () => {
  it('a never-run 13F harvest with discovery enabled is due', () => {
    const duties = resolveDutiesDue(baseInput())
    const discovery = duties.find((d) => d.id === 'discovery_13f')
    expect(discovery).toBeDefined()
    expect(discovery?.href).toBe('/discovery')
    expect(discovery?.detail).toContain('never run')
  })

  it('a fresh harvest inside the weekly window is NOT due; an overdue one is', () => {
    const fresh = resolveDutiesDue(baseInput({
      tasks: [{ task_kind: 'discovery_13f', last_completed_at: '2026-07-16T00:00:00.000Z' }],
    }))
    expect(fresh.find((d) => d.id === 'discovery_13f')).toBeUndefined()

    const overdue = resolveDutiesDue(baseInput({
      tasks: [{ task_kind: 'discovery_13f', last_completed_at: '2026-07-01T00:00:00.000Z' }],
    }))
    expect(overdue.find((d) => d.id === 'discovery_13f')?.detail).toContain('17 days')
  })

  it('the monthly cadence widens the discovery window', () => {
    const duties = resolveDutiesDue(baseInput({
      automation: { discovery: { enabled: true, cadence: 'monthly', auto_research: false }, thesis_review: { enabled: true, cadence: 'quarterly' } } as DutiesDueInput['automation'],
      tasks: [{ task_kind: 'discovery_13f', last_completed_at: '2026-07-01T00:00:00.000Z' }],
    }))
    expect(duties.find((d) => d.id === 'discovery_13f')).toBeUndefined()
  })

  it('discovery OFF (toggle or cadence off) never nags', () => {
    const toggledOff = resolveDutiesDue(baseInput({
      automation: { discovery: { enabled: false, cadence: 'weekly', auto_research: false }, thesis_review: { enabled: true, cadence: 'quarterly' } } as DutiesDueInput['automation'],
    }))
    expect(toggledOff.find((d) => d.id === 'discovery_13f')).toBeUndefined()

    const cadenceOff = resolveDutiesDue(baseInput({
      automation: { discovery: { enabled: true, cadence: 'off', auto_research: false }, thesis_review: { enabled: true, cadence: 'quarterly' } } as DutiesDueInput['automation'],
    }))
    expect(cadenceOff.find((d) => d.id === 'discovery_13f')).toBeUndefined()
  })

  it('the quarterly thesis check-in is due when decided names exist and the last check is older than a quarter', () => {
    const duties = resolveDutiesDue(baseInput({
      tasks: [{ task_kind: 're_review_check', last_completed_at: '2026-01-01T00:00:00.000Z' }],
    }))
    const checkIn = duties.find((d) => d.id === 'thesis_check_in')
    expect(checkIn).toBeDefined()
    // Holdings exist in the base input → the portfolio board is the destination.
    expect(checkIn?.href).toBe('/portfolio')
  })

  it('the thesis check-in points at the watchlist when nothing is held, and stays quiet with no decided names', () => {
    const watchOnly = resolveDutiesDue(baseInput({ open_holding_count: 0 }))
    expect(watchOnly.find((d) => d.id === 'thesis_check_in')?.href).toBe('/watchlist')

    const noTargets = resolveDutiesDue(baseInput({ decided_case_count: 0, open_holding_count: 0 }))
    expect(noTargets.find((d) => d.id === 'thesis_check_in')).toBeUndefined()
    expect(noTargets.find((d) => d.id === 'annual_re_analysis')).toBeUndefined()
  })

  it('a recent check-in silences the quarterly duty', () => {
    const duties = resolveDutiesDue(baseInput({
      tasks: [{ task_kind: 're_review_check', last_completed_at: '2026-06-30T00:00:00.000Z' }],
    }))
    expect(duties.find((d) => d.id === 'thesis_check_in')).toBeUndefined()
  })

  it('the annual re-analysis is due for held names once the last re-underwrite is over a year old', () => {
    const duties = resolveDutiesDue(baseInput({
      tasks: [
        { task_kind: 're_review_check', last_completed_at: '2026-07-01T00:00:00.000Z' },
        { task_kind: 're_underwrite', last_completed_at: '2025-06-01T00:00:00.000Z' },
      ],
    }))
    const annual = duties.find((d) => d.id === 'annual_re_analysis')
    expect(annual).toBeDefined()
    expect(annual?.href).toBe('/portfolio')

    const recent = resolveDutiesDue(baseInput({
      tasks: [
        { task_kind: 're_review_check', last_completed_at: '2026-07-01T00:00:00.000Z' },
        { task_kind: 're_underwrite', last_completed_at: '2026-01-01T00:00:00.000Z' },
      ],
    }))
    expect(recent.find((d) => d.id === 'annual_re_analysis')).toBeUndefined()
  })

  it('thesis_review OFF silences both review duties', () => {
    const duties = resolveDutiesDue(baseInput({
      automation: { discovery: { enabled: false, cadence: 'off', auto_research: false }, thesis_review: { enabled: false, cadence: 'quarterly' } } as DutiesDueInput['automation'],
    }))
    expect(duties).toEqual([])
  })
})
