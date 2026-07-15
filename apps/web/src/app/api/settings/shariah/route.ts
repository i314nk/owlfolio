import { NextResponse } from 'next/server'

import { getOnboardingState, updateShariahSettings } from '../../../../lib/onboarding'

/**
 * POST — update the Shariah screening settings (currently the on/off toggle). Accepts
 * `{ enabled: boolean }`. OFF is fail-visible downstream (gates record DISABLED decisions, chips
 * show GATE OFF, purification surfaces hide) — this route only flips the recorded setting.
 */
export async function POST(request: Request) {
  const state = await getOnboardingState()
  if (!state.is_initialized) {
    return NextResponse.json({ error: 'Onboarding is not initialized' }, { status: 409 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || typeof (body as Record<string, unknown>).enabled !== 'boolean') {
    return NextResponse.json({ error: 'Body must be { enabled: boolean }' }, { status: 400 })
  }

  const config = await updateShariahSettings({ enabled: (body as { enabled: boolean }).enabled })
  return NextResponse.json({ shariah: config.shariah })
}
