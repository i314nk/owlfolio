import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../../lib/onboarding'
import { rejectDiscoveryCandidate } from '../../../../../../lib/workflow'
import { statusFor } from '../../../statusFor'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const state = await getOnboardingState()
  let reason = ''
  try {
    const body = await request.json() as { reason?: unknown }
    if (typeof body?.reason === 'string') reason = body.reason
  } catch {
    /* empty body ok */
  }
  try {
    await rejectDiscoveryCandidate(state, id, reason)
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reject failed'
    return NextResponse.json({ error: message }, { status: statusFor(message) })
  }
}
