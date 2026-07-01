import { describe, expect, it } from 'vitest'

import { resolveRunProgress, type ResearchRunStageKey } from '../researchRunProgress'

function stateOf(progress: ReturnType<typeof resolveRunProgress>, key: ResearchRunStageKey) {
  return progress.stages.find((stage) => stage.key === key)?.state
}

describe('resolveRunProgress — stage mapping', () => {
  it('a freshly created case (discovered) → queued, in progress', () => {
    const p = resolveRunProgress({ stage: 'discovered' })
    expect(p.currentStage).toBe('queued')
    expect(p.inProgress).toBe(true)
    expect(stateOf(p, 'queued')).toBe('current')
    expect(stateOf(p, 'quick_screen')).toBe('pending')
  })

  it('no stage at all (run enqueued, case row not yet created) → queued', () => {
    const p = resolveRunProgress({})
    expect(p.currentStage).toBe('queued')
    expect(p.inProgress).toBe(true)
  })

  it('quick_screened → quick_screen done, circle current (worker goes straight to circle)', () => {
    const p = resolveRunProgress({ stage: 'quick_screened' })
    expect(p.currentStage).toBe('circle')
    expect(stateOf(p, 'quick_screen')).toBe('done')
    expect(stateOf(p, 'circle')).toBe('current')
    expect(stateOf(p, 'deep_dive')).toBe('pending')
  })

  it('circle_competence_judged → through circle, deep_dive current', () => {
    const p = resolveRunProgress({ stage: 'circle_competence_judged' })
    expect(p.currentStage).toBe('deep_dive')
    expect(stateOf(p, 'circle')).toBe('done')
    expect(stateOf(p, 'deep_dive')).toBe('current')
  })

  it.each([
    'queued_for_deep_dive',
    'deep_dive_started',
    'specialist_finding_recorded',
    'deep_dive_in_progress',
  ] as const)('%s → deep_dive current', (stage) => {
    const p = resolveRunProgress({ stage })
    expect(p.currentStage).toBe('deep_dive')
    expect(p.inProgress).toBe(true)
  })

  it.each([
    'deep_dive_synthesis_drafted',
    'deep_dive_completed',
    'deep_dive_complete',
    'decision_pending',
  ] as const)('%s → synthesis current', (stage) => {
    const p = resolveRunProgress({ stage })
    expect(p.currentStage).toBe('synthesis')
    expect(stateOf(p, 'deep_dive')).toBe('done')
    expect(stateOf(p, 'synthesis')).toBe('current')
    expect(p.inProgress).toBe(true)
  })
})

describe('resolveRunProgress — lane count drives the N/7 deep-dive label', () => {
  it('reflects the specialist finding count', () => {
    const p = resolveRunProgress({ stage: 'deep_dive_in_progress', specialistFindingCount: 3 })
    expect(p.lanes).toEqual({ completed: 3, total: 7 })
    expect(p.stages.find((s) => s.key === 'deep_dive')?.label).toBe('Deep dive — 3/7 specialists')
  })

  it('caps the completed count at 7 and floors at 0', () => {
    expect(resolveRunProgress({ stage: 'deep_dive_in_progress', specialistFindingCount: 99 }).lanes.completed).toBe(7)
    expect(resolveRunProgress({ stage: 'deep_dive_in_progress', specialistFindingCount: -5 }).lanes.completed).toBe(0)
  })

  it('defaults to 0/7 when no count is supplied', () => {
    expect(resolveRunProgress({ stage: 'deep_dive_in_progress' }).lanes).toEqual({ completed: 0, total: 7 })
  })
})

describe('resolveRunProgress — pauses and terminals', () => {
  it('awaiting_deep_dive_approval → awaitingApproval true, NOT in progress (page owns the approval branch)', () => {
    const p = resolveRunProgress({ stage: 'awaiting_deep_dive_approval' })
    expect(p.awaitingApproval).toBe(true)
    expect(p.inProgress).toBe(false)
    expect(p.failed).toBe(false)
  })

  it.each([
    'analysis_drafted',
    'decision_drafted',
    'pass',
    'rejected',
    'watchlist',
    'watchlist_draft',
    'holding',
  ] as const)('terminal stage %s → currentStage done, NOT in progress', (stage) => {
    const p = resolveRunProgress({ stage, specialistFindingCount: 7 })
    expect(p.currentStage).toBe('done')
    expect(p.inProgress).toBe(false)
    expect(p.awaitingApproval).toBe(false)
  })

  it('a full terminal run (7 lanes) marks every stage done', () => {
    const p = resolveRunProgress({ stage: 'decision_drafted', specialistFindingCount: 7 })
    expect(p.stages.every((s) => s.state === 'done')).toBe(true)
  })
})

describe('resolveRunProgress — failed flag', () => {
  it('failed → failed true, NOT in progress, even mid-stage', () => {
    const p = resolveRunProgress({ stage: 'deep_dive_in_progress', specialistFindingCount: 2, failed: true })
    expect(p.failed).toBe(true)
    expect(p.inProgress).toBe(false)
  })

  it('failed takes precedence over the approval pause', () => {
    const p = resolveRunProgress({ stage: 'awaiting_deep_dive_approval', failed: true })
    expect(p.failed).toBe(true)
    expect(p.awaitingApproval).toBe(false)
    expect(p.inProgress).toBe(false)
  })
})

describe('resolveRunProgress — circle set-aside does not mislabel skipped lanes', () => {
  it('terminal with NO lanes (set-aside / quick-screen reject) marks deep_dive + synthesis pending, not done', () => {
    const p = resolveRunProgress({ stage: 'decision_drafted', specialistFindingCount: 0 })
    expect(p.currentStage).toBe('done')
    expect(stateOf(p, 'circle')).toBe('done')
    expect(stateOf(p, 'deep_dive')).toBe('pending')
    expect(stateOf(p, 'synthesis')).toBe('pending')
    expect(stateOf(p, 'decision')).toBe('done')
  })
})
