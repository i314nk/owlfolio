import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../lib/onboarding'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const providerId = searchParams.get('provider')
  const state = await getOnboardingState()
  const config = providerId === null
    ? state.config
    : {
        ...state.config,
        provider: {
          ...state.config.provider,
          provider_id: providerId as typeof state.config.provider.provider_id,
        },
      }

  const readiness = await getProviderReadinessSnapshot(config)
  return NextResponse.json({ readiness })
}
