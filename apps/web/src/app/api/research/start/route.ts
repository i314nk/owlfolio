import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../lib/onboarding'
import { createPersonalResearchCase } from '../../../../lib/workflow'

function parseRequestBody(body: unknown): { ticker: string; company_id?: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object')
  }

  const record = body as Record<string, unknown>
  const ticker = typeof record.ticker === 'string' ? record.ticker.trim() : ''
  const companyId = typeof record.company_id === 'string' ? record.company_id.trim() : undefined

  if (ticker.length === 0) {
    throw new Error('Ticker is required')
  }

  return {
    ticker,
    ...(companyId === undefined || companyId.length === 0 ? {} : { company_id: companyId }),
  }
}

export async function POST(request: Request) {
  try {
    const state = await getOnboardingState()
    const parsed = parseRequestBody(await request.json())
    const readiness = await getProviderReadinessSnapshot(state.config)

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

    const created = await createPersonalResearchCase(state, parsed)

    return NextResponse.json({ research_case_id: created.research_case_id }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const isUnknownProvider = message.startsWith('Unknown provider:')

    return NextResponse.json(
      {
        error: isUnknownProvider
          ? {
              code: 'unknown_provider',
              message,
            }
          : message,
      },
      { status: 400 },
    )
  }
}
