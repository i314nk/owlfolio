import { NextResponse } from 'next/server'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { isUnconfiguredForUser } from '../../../../../lib/modeView'
import { resolveRunProgress, type RunProgress } from '../../../../../lib/researchRunProgress'

/**
 * GET — a LIGHT, read-only run-progress poll. Returns the stage-aware progress model the client poller
 * (`ResearchRunProgress`) renders while a deep dive is in flight, computed from the projection ONLY (no
 * market-quote / position-plan work). Mirrors the page's store/projection resolution. An unknown case → 404;
 * a failed run → 200 with `failed: true` so the poller can surface it without throwing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return NextResponse.json({ error: 'Unconfigured' }, { status: 404 })
  }

  const ledgerPath = state.config.ledger_path
  if (ledgerPath === undefined) {
    return NextResponse.json({ error: 'Personal-local workflow is not initialized' }, { status: 404 })
  }

  const store = new SQLiteEventStore(ledgerPath)
  let events: LedgerEventEnvelope<unknown>[]
  try {
    events = await store.list()
  } finally {
    store.close()
  }

  const failed = events.some(
    (event) => event.event_type === 'research_run_failed' && eventResearchCaseId(event) === caseId,
  )
  const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === caseId)

  if (researchCase === undefined) {
    if (failed) {
      const progress = resolveRunProgress({ failed: true })
      return NextResponse.json(toBody(progress), { status: 200 })
    }
    // No projected case, but the run was enqueued/claimed → still building (queued). Anything else → 404.
    const enqueued = events.some(
      (event) =>
        (event.event_type === 'research_run_requested' || event.event_type === 'research_run_claimed') &&
        eventResearchCaseId(event) === caseId,
    )
    if (!enqueued) {
      return NextResponse.json({ error: `Unknown research case: ${caseId}` }, { status: 404 })
    }
    const progress = resolveRunProgress({})
    return NextResponse.json(toBody(progress), { status: 200 })
  }

  // If no run has been requested/claimed yet for a case at the initial 'discovered' stage
  // (e.g. a discovery-promoted case), report not_started so the client can render a
  // "Ready to research" view rather than a permanent spinner.
  const runRequested = events.some(
    (e) =>
      (e.event_type === 'research_run_requested' || e.event_type === 'research_run_claimed') &&
      eventResearchCaseId(e) === caseId,
  )
  if (!runRequested && !failed && researchCase.stage === 'discovered') {
    return NextResponse.json(
      {
        stage: researchCase.stage,
        currentStage: 'not_started',
        inProgress: false,
        failed: false,
        awaitingApproval: false,
        notStarted: true,
        lanes: { completed: 0, total: 5 },
        stages: [],
      },
      { status: 200 },
    )
  }

  const progress = resolveRunProgress({
    stage: researchCase.stage,
    specialistFindingCount: researchCase.specialist_findings?.length ?? 0,
    failed,
  })
  return NextResponse.json({ stage: researchCase.stage, ...toBody(progress) }, { status: 200 })
}

function toBody(progress: RunProgress) {
  return {
    currentStage: progress.currentStage,
    inProgress: progress.inProgress,
    failed: progress.failed,
    awaitingApproval: progress.awaitingApproval,
    lanes: progress.lanes,
    stages: progress.stages,
    label: progress.stages.find((stage) => stage.state === 'current')?.label,
  }
}

function eventResearchCaseId(event: LedgerEventEnvelope<unknown>): string {
  const payload = event.payload
  if (payload !== null && typeof payload === 'object') {
    const id = (payload as Record<string, unknown>).research_case_id
    if (typeof id === 'string' && id.length > 0) {
      return id
    }
  }
  return event.aggregate_id
}
