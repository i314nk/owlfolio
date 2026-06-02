import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { recordPersonalHoldingValuation } from '../../../../../lib/workflow'

export type RecordHoldingValuationRouteContext = {
  params: Promise<{ holdingId: string }>
}

export async function POST(request: Request, { params }: RecordHoldingValuationRouteContext) {
  const { holdingId } = await params
  const state = await getOnboardingState()
  const formData = await request.formData()

  try {
    await recordPersonalHoldingValuation(state, holdingId, {
      price_per_share: formData.get('price_per_share'),
      currency: formData.get('currency'),
      valued_at: formData.get('valued_at'),
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown holding:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof Error && (
      error.message.startsWith('Valuation price')
      || error.message.startsWith('Valuation currency')
      || error.message.startsWith('Valuation date')
    )) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    throw error
  }

  redirect('/portfolio')
}
