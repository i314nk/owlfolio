import { describe, expect, it } from 'vitest'

import { VALUATION_PARAMS, type ValuationParams } from '../valuationParams'
import { buildValuationConfigChangeDraft } from '../valuationConfigEvent'
import { buffettMungerStrategy } from '../buffettMunger'

const tightened: ValuationParams = {
  ...VALUATION_PARAMS,
  version: 'valuation-test-tightened-1',
  single_growth_cap: 0.12,
}

describe('buildValuationConfigChangeDraft (gated, anti-drift param-change path)', () => {
  it('builds a DRAFT proposal that requires user confirmation and is not auto-applied', () => {
    const draft = buildValuationConfigChangeDraft({
      proposal_id: 'prop_1',
      strategy_id: buffettMungerStrategy.id,
      previous: VALUATION_PARAMS,
      next: tightened,
      calibration_run_event_id: 'evt_calibration_run_1',
      rationale: 'Annual review: 40/30/30 ladder under-deployed historically.',
      actor_id: 'user_admin',
    })

    expect(draft.status).toBe('draft')
    expect(draft.requires_user_confirmation).toBe(true)
    expect(draft.auto_applied).toBe(false)
    // The diff is computed, not asserted by the caller.
    expect(draft.changes).toEqual([
      { path: 'single_growth_cap', previous: 0.15, next: 0.12 },
    ])
    // The anti-drift precondition: a backtest must be attached (spec §3.4).
    expect(draft.calibration_run_event_id).toBe('evt_calibration_run_1')
    expect(draft.anti_drift_note).toMatch(/annual review|backtest|frozen/i)
  })

  it('refuses a no-op (no changed parameters)', () => {
    expect(() =>
      buildValuationConfigChangeDraft({
        proposal_id: 'prop_noop',
        strategy_id: buffettMungerStrategy.id,
        previous: VALUATION_PARAMS,
        next: { ...VALUATION_PARAMS, version: 'same-values-new-version' },
        calibration_run_event_id: 'evt_calibration_run_1',
      }),
    ).toThrow(/no parameter changes/i)
  })

  it('refuses a draft without an attached backtest (anti-drift precondition)', () => {
    expect(() =>
      buildValuationConfigChangeDraft({
        proposal_id: 'prop_nobacktest',
        strategy_id: buffettMungerStrategy.id,
        previous: VALUATION_PARAMS,
        next: tightened,
        calibration_run_event_id: '',
      }),
    ).toThrow(/backtest|calibration_run/i)
  })

  it('refuses to change the constitutional discount rate (spec §3.3 — never the 10% hurdle)', () => {
    expect(() =>
      buildValuationConfigChangeDraft({
        proposal_id: 'prop_discount',
        strategy_id: buffettMungerStrategy.id,
        previous: VALUATION_PARAMS,
        next: { ...VALUATION_PARAMS, version: 'looser-hurdle', discount_rate: 0.08 },
        calibration_run_event_id: 'evt_calibration_run_1',
      }),
    ).toThrow(/discount rate|constitutional|hurdle/i)
  })
})
