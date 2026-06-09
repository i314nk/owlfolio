import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { requestDeepDiveRun } from '../../../../../lib/workflow'

export async function POST(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await params
    const state = await getOnboardingState()
    const { research_case_id } = await requestDeepDiveRun(state, caseId)
    return NextResponse.json({ research_case_id }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
