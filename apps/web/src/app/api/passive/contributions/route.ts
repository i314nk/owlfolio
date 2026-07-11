import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../lib/onboarding'
import { recordPassiveContribution } from '../../../../lib/workflow'

/**
 * POST — record a PASSIVE DCA contribution (B7, book rules 1–2). USER-AUTHORED, append-only: a local
 * record of an index purchase already made elsewhere — no broker call, no execution. There is
 * deliberately NO delete/withdraw counterpart (rule 3: a lifelong commitment has no exit button).
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount <= 0) {
      return NextResponse.json({ error: { code: 'invalid_contribution', message: 'amount must be a positive number' } }, { status: 400 })
    }
    const state = await getOnboardingState()
    const { contribution_id } = await recordPassiveContribution(state, {
      amount: b.amount,
      ...(typeof b.contributed_at === 'string' ? { contributed_at: b.contributed_at } : {}),
      ...(typeof b.instrument === 'string' ? { instrument: b.instrument } : {}),
      ...(typeof b.note === 'string' ? { note: b.note } : {}),
    })
    return NextResponse.json({ contribution_id }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error recording the contribution'
    if (message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: { code: 'not_initialized', message } }, { status: 409 })
    }
    return NextResponse.json({ error: { code: 'contribution_error', message } }, { status: 400 })
  }
}
