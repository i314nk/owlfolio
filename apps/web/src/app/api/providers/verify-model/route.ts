import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NextResponse } from 'next/server'

import {
  certificationReportTargetFileStem,
  resolveProvider,
  runProviderCertification,
  type CertificationReport,
  type CertificationScenarioId,
} from '@owlfolio/providers'

import { getOnboardingState } from '../../../../lib/onboarding'
import { resolveProviderCertificationReportDir } from '../../../../lib/providerStatus'

/**
 * The capability-probe core: does THIS routed model actually honor the loop the harness depends on?
 * A thin, user-fired slice of the full 18-scenario certification (which stays the deeper audit).
 */
export const CAPABILITY_PROBE_SCENARIOS: CertificationScenarioId[] = [
  'simple-completion',
  'structured-json-output',
  'tool-call-round-trip',
  'multi-step-tool-loop',
]

/** Test-only seam: inject the certify call (no live provider in unit tests). */
type VerifyModelRouteDeps = {
  certify?: (providerId: string, modelId: string) => Promise<CertificationReport>
}

/**
 * POST — run the per-model capability probe against the CONFIGURED provider+model and persist the
 * result as a target-specific certification report (the same store the providers page reads, so the
 * verified state survives restarts and bounds support labels the standard way). Fired from the
 * providers page's "Verify current model" form; browser posts get a 303 back to the page.
 */
export async function POST(request: Request, _context?: unknown, deps: VerifyModelRouteDeps = {}) {
  const state = await getOnboardingState()
  const providerId = state.config.provider.provider_id
  const modelId = state.config.provider.model_id
  if (!state.is_initialized || modelId === undefined || modelId.length === 0) {
    return NextResponse.json({ error: { code: 'no_model_configured', message: 'Configure a provider and model before verifying.' } }, { status: 409 })
  }

  const certify = deps.certify ?? (async (pid: string, mid: string) => {
    const provider = resolveProvider({ provider_id: pid as Parameters<typeof resolveProvider>[0]['provider_id'] })
    return runProviderCertification(provider, {
      model_id: mid,
      workflow_role: 'research_draft',
      scenarios: CAPABILITY_PROBE_SCENARIOS,
    })
  })

  try {
    const report = await certify(providerId, modelId)
    // Persist through the standard store: <stem>.latest.json is what readiness/status readers consume.
    const dir = resolveProviderCertificationReportDir()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${certificationReportTargetFileStem(report)}.latest.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

    const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html')
    if (wantsHtml) {
      return NextResponse.redirect(new URL('/settings/providers', request.url), 303)
    }
    return NextResponse.json({
      provider_id: providerId,
      model_id: modelId,
      support_level: report.support_level,
      summary: report.summary,
      scenarios: report.cases.map((entry) => ({ scenario_id: entry.scenario_id, passed: entry.passed, status: entry.status })),
    }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'verification failed'
    return NextResponse.json({ error: { code: 'verify_model_failed', message } }, { status: 502 })
  }
}
