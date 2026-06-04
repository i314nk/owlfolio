import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot, initializeSelectedMode, type OnboardingConfigUpdate } from '../../../../lib/onboarding'

export async function POST(request: Request) {
  try {
    const runtimeOptions = { env: process.env }
    const update = (await request.json()) as OnboardingConfigUpdate
    const state = await getOnboardingState()
    const config = {
      ...state.config,
      ...update,
      provider: {
        ...state.config.provider,
        ...update.provider,
      },
      shariah: {
        ...state.config.shariah,
        ...update.shariah,
      },
      market_universe: {
        ...state.config.market_universe,
        ...update.market_universe,
      },
    }
    const readiness = await getProviderReadinessSnapshot(config, runtimeOptions)
    if (!readiness.is_ready) {
      return NextResponse.json(
        {
          error: {
            code: 'provider_not_ready',
            message: `Provider ${readiness.provider_id} is not ready: ${readiness.status_label}`,
          },
        },
        { status: 400 },
      )
    }

    const initializedConfig = await initializeSelectedMode(update)

    return NextResponse.json({
      config: initializedConfig,
      next_destination: '/',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown onboarding start error'
    const isUnknownProvider = message.startsWith('Unknown provider:')

    return NextResponse.json(
      {
        error: {
          code: isUnknownProvider ? 'unknown_provider' : 'onboarding_start_error',
          message,
        },
      },
      { status: isUnknownProvider ? 400 : 500 },
    )
  }
}
