import { NextResponse } from 'next/server'

import { getOnboardingProviderOptions, getOnboardingState, updateOnboardingConfig } from '../../../../lib/onboarding'

export async function GET() {
  const state = await getOnboardingState()
  return NextResponse.json({
    ...state,
    provider_options: await getOnboardingProviderOptions(),
  })
}

export async function PUT(request: Request) {
  const update = await request.json()
  const config = await updateOnboardingConfig(update)
  const state = await getOnboardingState()

  return NextResponse.json({
    config,
    is_initialized: state.is_initialized,
    provider_options: await getOnboardingProviderOptions(),
  })
}
