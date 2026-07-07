import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../../lib/onboarding'
import { promoteDiscoveryCandidate } from '../../../../../../lib/workflow'
import { statusFor } from '../../../statusFor'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const state = await getOnboardingState()
  try {
    const result = await promoteDiscoveryCandidate(state, id)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'promote failed'
    return NextResponse.json({ error: message }, { status: statusFor(message) })
  }
}
