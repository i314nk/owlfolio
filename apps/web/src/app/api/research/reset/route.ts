import { NextResponse } from 'next/server'

import { isResearchResetEnabled } from '../../../../lib/devTools'
import { getOnboardingState } from '../../../../lib/onboarding'
import { resetResearchLedgerState } from '../../../../lib/workflow'

/**
 * POST — DESTRUCTIVE dev/test-only wholesale clear of the active local ledger + source bundles.
 *
 * Mirrors the testing/reset gate idiom: when the dev-tools gate is NOT enabled (normal personal-local with
 * no opt-in) the route returns 404 `{ error: 'Not found' }` so the destructive surface is invisible in
 * production operation. When enabled it truncates the active ledger (app config preserved) and returns the
 * cleared event count.
 *
 * This is SEPARATE from the append-only single-run archive route — it is the gated wholesale clear.
 */
export async function POST() {
  const state = await getOnboardingState()

  if (!isResearchResetEnabled({ env: process.env, mode: state.config.mode })) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const { cleared_events } = await resetResearchLedgerState(state, { env: process.env })
    return NextResponse.json({ reset: true, cleared_events }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
