import { NextResponse } from 'next/server'

import { initializeSelectedMode, type OnboardingConfigUpdate } from '../../../../lib/onboarding'

const PLAYWRIGHT_TEST_MODE = 'playwright'

/**
 * Test-mode-only programmatic onboarding init. Mirrors `api/testing/reset` gating: it 404s outside
 * `OWLFOLIO_TEST_MODE === 'playwright'` so it can never run against a real user's environment.
 *
 * Unlike `POST /api/onboarding/start` (which routes mock-provider + personal-local through the
 * `normalizeOnboardingStartUpdate` "silent demo trap" rewrite), this helper passes the update straight
 * to `initializeSelectedMode` so e2e specs can initialize mock-provider + personal-local DIRECTLY without
 * driving the wizard UI. This is the programmatic-init seam that lets the wizard be deleted in a later
 * slice. It is fail-closed: no body, no test mode, no init.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.OWLFOLIO_TEST_MODE !== PLAYWRIGHT_TEST_MODE) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let update: OnboardingConfigUpdate
  try {
    update = (await request.json()) as OnboardingConfigUpdate
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body', message: 'Invalid JSON body' } }, { status: 400 })
  }

  try {
    const config = await initializeSelectedMode(update)
    return NextResponse.json({ config, initialized: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown init error'
    return NextResponse.json({ error: { code: 'init_error', message } }, { status: 500 })
  }
}
