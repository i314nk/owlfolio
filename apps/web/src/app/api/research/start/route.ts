import { NextResponse } from 'next/server'

import { preflightProviderKeyGuard, readAllEnvKeys, type PreflightKeyGuardResult } from '@owlfolio/onboarding'

import { evaluateCircleGate } from '../../../../lib/circleGate'
import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../lib/onboarding'
import { evaluateOnboardingGate } from '../../../../lib/onboardingGate'
import { enqueueResearchRun } from '../../../../lib/workflow'

function parseRequestBody(body: unknown): { ticker: string; company_id?: string; supersedes_research_case_id?: string; moat_gate_override?: boolean } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object')
  }

  const record = body as Record<string, unknown>
  const ticker = typeof record.ticker === 'string' ? record.ticker.trim() : ''
  const companyId = typeof record.company_id === 'string' ? record.company_id.trim() : undefined

  if (ticker.length === 0) {
    throw new Error('Ticker is required')
  }
  // Ticker-sanity guard: a legacy failed case without a recorded ticker falls back to its case id on
  // the boards; restarting THAT must not mint a case whose "ticker" is a research-case id.
  if (/^rc[_-]/i.test(ticker)) {
    throw new Error(`"${ticker}" looks like a research-case id, not a ticker symbol — open the case and re-run it with its real ticker.`)
  }

  // Optional explicit re-run supersession: when the dossier's "Re-run on current engine" action starts a
  // NEW run that supersedes a specific prior case, it passes that case id here. Absent → today's behavior
  // (a plain new run; auto-versioning still supersedes the latest case for the ticker). When PRESENT it
  // must be a non-empty string — a `supersedes_research_case_id` key that is the wrong type or blank is a
  // malformed request, not a silent fall-through to a plain run.
  let supersedesResearchCaseId: string | undefined
  if ('supersedes_research_case_id' in record && record.supersedes_research_case_id !== undefined) {
    if (typeof record.supersedes_research_case_id !== 'string' || record.supersedes_research_case_id.trim().length === 0) {
      throw new Error('supersedes_research_case_id must be a non-empty string')
    }
    supersedesResearchCaseId = record.supersedes_research_case_id.trim()
  }

  // S6: the user-authored moat-gate override — strictly boolean true (anything else is malformed).
  let moatGateOverride: boolean | undefined
  if ('moat_gate_override' in record && record.moat_gate_override !== undefined) {
    if (record.moat_gate_override !== true && record.moat_gate_override !== false) {
      throw new Error('moat_gate_override must be a boolean')
    }
    moatGateOverride = record.moat_gate_override
  }

  return {
    ticker,
    ...(companyId === undefined || companyId.length === 0 ? {} : { company_id: companyId }),
    ...(supersedesResearchCaseId === undefined ? {} : { supersedes_research_case_id: supersedesResearchCaseId }),
    ...(moatGateOverride === true ? { moat_gate_override: true } : {}),
  }
}

/** Test-only seam for the pre-flight key guard (fake env-file read / fake live validation). */
type StartRouteDeps = {
  keyGuard?: (providerId: string) => Promise<PreflightKeyGuardResult>
}

export async function POST(request: Request, _context?: unknown, deps: StartRouteDeps = {}) {
  try {
    const runtimeOptions = { env: process.env }
    const state = await getOnboardingState()
    const parsed = parseRequestBody(await request.json())
    // PRE-FLIGHT KEY GUARD (reliability) — deliberately BEFORE the readiness gate: keys hydrate into
    // process.env once at server boot, and the spawned worker inherits that env — so a key saved or
    // changed via the UI after boot means the RUN would use a stale/missing key and die mid-swarm
    // (while the providers page, which reads the file fresh, says "connected"). The guard fails fast
    // with the honest fix ("restart to apply") where the readiness gate would only say "missing key",
    // and live-validates the run-effective OpenRouter key (definitive 401/403 blocks; the probe fails
    // open on network flakiness). A truly-absent key falls through to the readiness gate below.
    const keyGuard = deps.keyGuard ?? (async (providerId: string) => preflightProviderKeyGuard({
      providerId,
      processEnv: process.env,
      fileEnv: await readAllEnvKeys({ env: process.env }),
    }))
    const guard = await keyGuard(state.config.provider.provider_id)
    if (!guard.ok) {
      return NextResponse.json({ error: { code: guard.code, message: guard.message } }, { status: 400 })
    }

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
    // checklist (one frontier LLM connected · investable capital) is complete —
    // and name exactly which item is missing. A market-data key is NOT required
    // (the owner uses SEC EDGAR directly); it stays settable but never blocks.
    // Skipped only under the Playwright e2e harness (a controlled mock-provider
    // setup that does not exercise onboarding); the gate logic + this refusal
    // remain covered by the vitest route unit test and the onboarding flow.
    const skipOnboardingGate = process.env['OWLFOLIO_TEST_MODE'] === 'playwright'
    const gate = await evaluateOnboardingGate({
      ledgerPath: state.config.ledger_path,
      configuredProviderReady: readiness.is_ready,
    })
    if (!skipOnboardingGate && !gate.is_complete) {
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

    // Circle-of-competence PRE-SPEND gate: when the owner has ENABLED a boundary, reject an
    // out-of-circle candidate BEFORE any expensive research is spent — no research case is created.
    // Permissive default (enabled !== true) skips this entirely so the common path is unchanged (no
    // extra fetch). The decision is config-only — there is NO LLM in the circle path.
    const circleConfig = state.config.circle_of_competence
    if (circleConfig?.enabled === true) {
      const circle = await evaluateCircleGate(circleConfig, parsed.ticker)
      if (!circle.allowed) {
        return NextResponse.json(
          {
            error: {
              code: 'out_of_circle',
              message: `Out of circle of competence: ${circle.reason}`,
            },
          },
          { status: 400 },
        )
      }
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
