import { NextResponse } from 'next/server'

import type { AppConfig } from '@owlfolio/shared'

import { getOnboardingState, getProviderReadinessSnapshot, initializeSelectedMode, type OnboardingConfigUpdate } from '../../../../lib/onboarding'

type StartRouteEnv = {
  [key: string]: string | undefined
  OWLFOLIO_TEST_MODE?: string
}

export function normalizeOnboardingStartUpdate(
  update: OnboardingConfigUpdate,
  current: AppConfig,
  env: StartRouteEnv = process.env,
): OnboardingConfigUpdate {
  if (env.OWLFOLIO_TEST_MODE === 'playwright') {
    return update
  }

  const effectiveMode = update.mode ?? current.mode
  const effectiveProviderId = update.provider?.provider_id ?? current.provider.provider_id

  if (effectiveProviderId === 'mock-provider' && effectiveMode === 'personal-local') {
    return {
      ...update,
      mode: 'demo',
    }
  }

  return update
}

export async function POST(request: Request) {
  try {
    const runtimeOptions = { env: process.env }
    const rawUpdate = (await request.json()) as OnboardingConfigUpdate
    const state = await getOnboardingState()
    const update = normalizeOnboardingStartUpdate(rawUpdate, state.config, process.env)
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
