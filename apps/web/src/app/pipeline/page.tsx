import { buildPipelineDrillDown, projectPipeline } from '@owlfolio/ledger/projections/pipelineProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PipelineObservatory } from '../../components/PipelineObservatory'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { resolveDemoLedgerPath, seedDemoLedger } from '../../lib/demo'
import { isUnconfigured } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'

export type PipelinePageProps = {
  searchParams: Promise<{ case?: string }>
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const { case: requestedCaseId } = await searchParams
  const state = await getOnboardingState()
  if (isUnconfigured(state.config)) {
    return <UnconfiguredNotice feature="Pipeline" />
  }

  const store = state.config.mode === 'demo'
    ? new SQLiteEventStore(resolveDemoLedgerPath())
    : new SQLiteEventStore(state.config.ledger_path)

  try {
    if (state.config.mode === 'demo') {
      await seedDemoLedger(store)
    }

    const events = await store.list()
    const pipeline = projectPipeline(events)

    // Pre-select the requested run, else the most recent active run, else the most recent run.
    const selectedRun = requestedCaseId !== undefined
      ? pipeline.runs.find((run) => run.research_case_id === requestedCaseId)
      : pipeline.runs.find((run) => run.status === 'running' || run.status === 'awaiting_approval')
        ?? pipeline.runs[0]

    const drillDown = selectedRun !== undefined
      ? buildPipelineDrillDown(events, selectedRun.research_case_id)
      : undefined

    return (
      <main className="owl-route-frame owl-route-frame-wide">
        <p className="owl-route-back-row">
          <a className="owl-back-link owl-focusable" href="/">
            ← Back to command center
          </a>
        </p>
        <PipelineObservatory
          pipeline={pipeline}
          mode={state.config.mode}
          {...(drillDown !== undefined ? { drillDown } : {})}
          {...(selectedRun !== undefined ? { selectedCaseId: selectedRun.research_case_id } : {})}
        />
      </main>
    )
  } finally {
    store.close()
  }
}
