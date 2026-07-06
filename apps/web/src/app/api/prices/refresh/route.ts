import { NextResponse } from 'next/server'
import { getOnboardingState } from '../../../../lib/onboarding'
import { refreshPrices } from '../../../../lib/workflow'
import type { RunPriceRefreshDeps } from '@owlfolio/workflow/priceRefresh'

export async function POST(_request: Request, deps: RunPriceRefreshDeps = {}) {
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
