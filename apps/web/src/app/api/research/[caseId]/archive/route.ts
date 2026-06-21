import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { archiveAppResearchCase } from '../../../../../lib/workflow'

/**
 * POST — ARCHIVE a stale research run (option-b append-only archive). Appends a single
 * `research_case_archived` event so the ACTIVE research surfaces (pipeline counts + runs, the research
 * library, the latest-per-ticker resolution) hide the case WITHOUT mutating the append-only ledger — the case
 * still projects + its dossier still renders directly. State-writing admin action gated like the other
 * research write-routes (deep-dive): personal-local only via the onboarding state; idempotent (re-archiving
 * is a harmless no-op via the deterministic idempotency_key). Returns the archived case_id.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await params
    const state = await getOnboardingState()
    const { research_case_id } = await archiveAppResearchCase(state, caseId)
    return NextResponse.json({ research_case_id }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message.startsWith('Unknown research case:')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
