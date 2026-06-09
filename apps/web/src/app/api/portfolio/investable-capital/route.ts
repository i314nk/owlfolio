import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../lib/onboarding'
import { setInvestableCapital } from '../../../../lib/workflow'

export async function POST(request: Request) {
  const state = await getOnboardingState()
  const formData = await request.formData()

  try {
    await setInvestableCapital(state, {
      amount: formData.get('amount'),
      currency: formData.get('currency'),
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Investable capital')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    throw error
  }

  redirect('/portfolio')
}
