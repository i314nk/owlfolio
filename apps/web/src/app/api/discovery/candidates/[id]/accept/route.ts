import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../../lib/onboarding'
import { acceptDiscoveryCandidate } from '../../../../../../lib/workflow'
import { statusFor } from '../../../statusFor'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const state = await getOnboardingState()
  try {
    await acceptDiscoveryCandidate(state, id)
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'accept failed'
    return NextResponse.json({ error: message }, { status: statusFor(message) })
  }
}
