import { NextResponse } from 'next/server'

import { resetOnboardingRuntime } from '../../../../lib/onboarding'

const PLAYWRIGHT_TEST_MODE = 'playwright'

export async function POST() {
  if (process.env.OWLFOLIO_TEST_MODE !== PLAYWRIGHT_TEST_MODE) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await resetOnboardingRuntime()
  return NextResponse.json({ reset: true })
}
