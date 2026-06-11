import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { removeCalibrationUniverseMember } from '../../../../../lib/calibrationActions'

/**
 * Remove a ticker from the calibration universe (tombstones a seed name until re-added). Records a
 * user-authored `calibration_universe_member_removed` ledger event and returns the updated projected
 * universe. Reversible, directly user-authored, recorded immediately (Rule 1).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { ticker?: unknown }
    const ticker = typeof body.ticker === 'string' ? body.ticker : ''

    const state = await getOnboardingState()
    const universe = await removeCalibrationUniverseMember(state, { ticker })
    return NextResponse.json({ universe }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
