import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../lib/onboarding'
import { evaluateOnboardingGate } from '../../../../lib/onboardingGate'
import { enqueueResearchRun } from '../../../../lib/workflow'

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
    const runtimeOptions = { env: process.env }
    const state = await getOnboardingState()
    const parsed = parseRequestBody(await request.json())
    const readiness = await getProviderReadinessSnapshot(state.config, runtimeOptions)

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

    // Onboarding gate: refuse to start a deep dive until the minimal-viable
    // checklist (one frontier LLM connected · market-data key · investable
    // capital) is complete — and name exactly which item is missing.
    const gate = await evaluateOnboardingGate({
      ledgerPath: state.config.ledger_path,
      configuredProviderReady: readiness.is_ready,
    })
    if (!gate.is_complete) {
      return NextResponse.json(
        {
          error: {
            code: 'onboarding_incomplete',
            message: gate.blocked_reason ?? 'Cannot start a deep dive: onboarding is incomplete.',
            missing_items: gate.missing_items.map((item) => item.label),
          },
        },
        { status: 400 },
      )
    }

    const { research_case_id } = await enqueueResearchRun(state, parsed)

    return NextResponse.json({ research_case_id }, { status: 202 })
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
