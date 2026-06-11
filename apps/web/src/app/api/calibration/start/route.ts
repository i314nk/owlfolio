import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../lib/onboarding'
import { enqueueCalibrationRun } from '../../../../lib/calibrationActions'

/**
 * Enqueue a calibration backtest run (valuation-recalibration-spec §3 — deliberate, enqueued). Mirrors
 * /api/research/start: records a `calibration_run_requested` ledger event and spawns the worker, returning
 * 202 (Accepted). The backtest itself is deterministic + observation-only and runs in the worker (it
 * fetches EDGAR + 10yr prices — network-bound, never a synchronous HTTP request). The /calibration page
 * renders the recorded run once the worker completes.
 */
export async function POST() {
  try {
    const state = await getOnboardingState()
    const { calibration_run_id } = await enqueueCalibrationRun(state)
    return NextResponse.json({ calibration_run_id }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
