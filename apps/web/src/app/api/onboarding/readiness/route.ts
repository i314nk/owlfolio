import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../lib/onboarding'

export async function GET(request: Request) {
  const runtimeOptions = { env: process.env }
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

  try {
    const readiness = await getProviderReadinessSnapshot(config, runtimeOptions)
    return NextResponse.json({ readiness })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown provider readiness error'
    const isUnknownProvider = message.startsWith('Unknown provider:')

    return NextResponse.json(
      {
        error: {
          code: isUnknownProvider ? 'unknown_provider' : 'provider_readiness_error',
          message,
        },
      },
      { status: isUnknownProvider ? 400 : 500 },
    )
  }
}
