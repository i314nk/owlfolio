import { NextResponse } from 'next/server'

import {
  defaultValuationConfig,
  REQUIRED_RETURN_MAX,
  REQUIRED_RETURN_MIN,
  type ValuationConfig,
} from '@owlfolio/shared'

import { getOnboardingState, updateOnboardingConfig } from '../../../../lib/onboarding'

// Phase 4 (book alignment): the REQUIRED-RETURN setting — the flat discount/hurdle for the 10-year
// FCF valuation. Default 15% (the book: "anything less, you might as well buy the index" — it doubles
// as the active-vs-passive hurdle). One user-owned number; deliberately NOT a per-name override.
// Out-of-band values are REJECTED with 400; the config-layer fail-closed clamp remains the backstop.

function inBand(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= REQUIRED_RETURN_MIN && value <= REQUIRED_RETURN_MAX
}

function currentValuation(valuation: Partial<ValuationConfig> | undefined): ValuationConfig {
  return {
    ...defaultValuationConfig(),
    ...(valuation?.required_return !== undefined ? { required_return: valuation.required_return } : {}),
    ...(valuation?.required_return_set_at !== undefined ? { required_return_set_at: valuation.required_return_set_at } : {}),
  }
}

export async function GET() {
  const state = await getOnboardingState()
  return NextResponse.json({
    valuation: currentValuation(state.config.valuation),
    // USER-SET vs the fail-closed 15% default — the vintage stamp is the signal (mirrors the savings route).
    configured: state.config.valuation?.required_return_set_at !== undefined,
  })
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>

    if (!inBand(b.required_return)) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_valuation_update',
            message: `required_return must be a number between ${REQUIRED_RETURN_MIN} and ${REQUIRED_RETURN_MAX} (decimal, e.g. 0.15 for 15%)`,
          },
        },
        { status: 400 },
      )
    }

    const state = await getOnboardingState()
    // updateOnboardingConfig routes valuation writes through mergeValuationConfig, which STAMPS the
    // vintage (required_return_set_at) on a change to a non-default value.
    const config = await updateOnboardingConfig({
      valuation: {
        ...state.config.valuation,
        required_return: b.required_return,
      },
    })
    return NextResponse.json({ valuation: currentValuation(config.valuation), configured: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error updating the required return'
    return NextResponse.json({ error: { code: 'valuation_update_error', message } }, { status: 500 })
  }
}
