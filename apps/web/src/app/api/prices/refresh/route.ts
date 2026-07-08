import { NextResponse } from 'next/server'
import { getOnboardingState } from '../../../../lib/onboarding'
import { refreshPrices } from '../../../../lib/workflow'
import type { RunPriceRefreshDeps } from '@owlfolio/workflow/priceRefresh'

// Signature: (request, context, deps) — Next's route type check requires the SECOND param to be the
// route context; the injectable test-deps seam must sit third (this broke `next build` when deps sat
// second). Mirrors the admit-judgment / re-review routes.
export async function POST(_request: Request, _context?: unknown, deps: RunPriceRefreshDeps = {}) {
  const state = await getOnboardingState()
  try {
    const result = await refreshPrices(state, deps)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'price refresh failed'
    const status = message.startsWith('Personal-local workflow is not initialized') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
