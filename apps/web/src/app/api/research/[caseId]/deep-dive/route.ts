import { NextResponse } from 'next/server'

import { preflightProviderKeyGuard, readAllEnvKeys, type PreflightKeyGuardResult } from '@owlfolio/onboarding'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { requestDeepDiveRun } from '../../../../../lib/workflow'

/** Test-only seam for the pre-flight key guard (fake env-file read / fake live validation). */
type DeepDiveRouteDeps = {
  keyGuard?: (providerId: string) => Promise<PreflightKeyGuardResult>
}

export async function POST(_request: Request, { params }: { params: Promise<{ caseId: string }> }, deps: DeepDiveRouteDeps = {}) {
  try {
    const { caseId } = await params
    const state = await getOnboardingState()

    // Pre-flight key guard — same rationale as /api/research/start: fail fast on a stale/not-loaded/
    // revoked run-effective key instead of burning a deep dive mid-swarm (the worker inherits this
    // server's boot-time process.env).
    const guard = await (deps.keyGuard ?? (async (providerId: string) => preflightProviderKeyGuard({
      providerId,
      processEnv: process.env,
      fileEnv: await readAllEnvKeys({ env: process.env }),
    })))(state.config.provider.provider_id)
    if (!guard.ok) {
      return NextResponse.json({ error: { code: guard.code, message: guard.message } }, { status: 400 })
    }

    const { research_case_id } = await requestDeepDiveRun(state, caseId)
    return NextResponse.json({ research_case_id }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
