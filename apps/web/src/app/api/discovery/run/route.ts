import { NextResponse } from 'next/server'
import { getOnboardingState } from '../../../../lib/onboarding'
import { enqueueDiscoveryRun, type EnqueueDiscoveryRunDeps } from '../../../../lib/workflow'

export async function POST(_request: Request, deps: EnqueueDiscoveryRunDeps = {}) {
  const state = await getOnboardingState()
  try {
    const result = await enqueueDiscoveryRun(state, deps)
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'discovery run failed'
    const status = message.startsWith('Personal-local workflow is not initialized') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
