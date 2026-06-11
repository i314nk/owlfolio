import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { enqueueCalibrationRun, proposeValuationConfigChange } from '../calibrationActions'
import type { OnboardingState } from '../onboarding'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function personalState(): OnboardingState {
  const dir = mkdtempSync(join(tmpdir(), 'owl-cal-'))
  dirs.push(dir)
  return {
    is_initialized: true,
    config: {
      mode: 'personal-local',
      ledger_path: join(dir, 'ledger.sqlite'),
      source_ledger_path: join(dir, 'source-ledger'),
      strategy_id: 'buffett-munger',
      provider: { provider_id: 'mock-provider' },
    },
  } as unknown as OnboardingState
}

describe('enqueueCalibrationRun', () => {
  it('records a calibration_run_requested event and spawns the worker (no synchronous backtest)', async () => {
    const state = personalState()
    let spawned = false
    const result = await enqueueCalibrationRun(state, { spawn: () => { spawned = true } })

    expect(result.calibration_run_id).toMatch(/^cal_/)
    expect(spawned).toBe(true)

    const store = new SQLiteEventStore(state.config.ledger_path!)
    try {
      const events = await store.list()
      const requested = events.filter((e) => e.event_type === 'calibration_run_requested')
      expect(requested).toHaveLength(1)
      expect((requested[0]!.payload as Record<string, unknown>)['strategy_id']).toBe('buffett-munger')
      // The enqueue does NOT synchronously run the backtest → no calibration_run recorded yet.
      expect(events.some((e) => e.event_type === 'calibration_run')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('throws when the workflow is not initialized', async () => {
    const state = { is_initialized: false, config: { mode: 'personal-local' } } as unknown as OnboardingState
    await expect(enqueueCalibrationRun(state, { spawn: () => {} })).rejects.toThrow(/not initialized/i)
  })
})

describe('proposeValuationConfigChange', () => {
  it('builds a gated config-change DRAFT requiring confirmation, with the backtest attached', () => {
    const draft = proposeValuationConfigChange({
      strategy_id: 'buffett-munger',
      next: { margin_of_safety_by_moat: { monopoly: 0.20, wide: 0.30 }, version: 'valuation-proposed-1' },
      calibration_run_event_id: 'evt_calibration_run_cal_1',
      rationale: 'Annual review; ladder under-deployed.',
    })
    expect(draft.status).toBe('draft')
    expect(draft.requires_user_confirmation).toBe(true)
    expect(draft.auto_applied).toBe(false)
    expect(draft.calibration_run_event_id).toBe('evt_calibration_run_cal_1')
    expect(draft.changes.length).toBeGreaterThan(0)
  })

  it('refuses a proposal without an attached backtest (anti-drift §3.4)', () => {
    expect(() =>
      proposeValuationConfigChange({
        strategy_id: 'buffett-munger',
        next: { margin_of_safety_by_moat: { monopoly: 0.20, wide: 0.30 }, version: 'v' },
        calibration_run_event_id: '',
      }),
    ).toThrow(/backtest|calibration_run/i)
  })
})
