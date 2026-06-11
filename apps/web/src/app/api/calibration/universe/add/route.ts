import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { addCalibrationUniverseMember } from '../../../../../lib/calibrationActions'
import type { CalibrationMarket } from '@owlfolio/workflow/calibrationUniverse'

/**
 * Add a ticker to the calibration universe (valuation-recalibration-spec §3.1 — the universe is USER-OWNED).
 * Records a user-authored `calibration_universe_member_added` ledger event and returns the updated projected
 * universe (seed config + events). Curation is low-stakes, reversible, directly user-authored — recorded
 * immediately, no draft-for-confirmation step (Rule 1: the UI is a projection of the ledger).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      ticker?: unknown
      company?: unknown
      market?: unknown
    }
    const ticker = typeof body.ticker === 'string' ? body.ticker : ''
    const company = typeof body.company === 'string' ? body.company : undefined
    const market: CalibrationMarket | undefined = body.market === 'intl' ? 'intl' : body.market === 'US' ? 'US' : undefined

    const state = await getOnboardingState()
    const universe = await addCalibrationUniverseMember(state, {
      ticker,
      ...(company === undefined ? {} : { company }),
      ...(market === undefined ? {} : { market }),
    })
    return NextResponse.json({ universe }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
