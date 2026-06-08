import { notFound } from 'next/navigation'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { ResearchCasePanel } from '../../../components/ResearchCasePanel'
import { getDemoResearchCase, resolveDemoLedgerPath } from '../../../lib/demo'
import { getOnboardingState } from '../../../lib/onboarding'
import { getAppResearchCaseFromStore } from '../../../lib/workflow'

export type ResearchCasePageProps = {
  params: Promise<{ caseId: string }>
}

export default async function ResearchCasePage({ params }: ResearchCasePageProps) {
  const { caseId } = await params
  const state = await getOnboardingState()

  try {
    const researchCase = state.config.mode === 'demo'
      ? await getDemoResearchCase(caseId)
      : await loadPersonalResearchCase(caseId, state.config.ledger_path, state.config.source_ledger_path)

    return (
      <main className="owl-route-frame">
        <p className="owl-route-back-row">
          <a className="owl-back-link owl-focusable" href="/">
            ← Back to command center
          </a>
        </p>
        <ResearchCasePanel researchCase={researchCase} mode={state.config.mode} />
      </main>
    )
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('Unknown demo research case:') || error.message.startsWith('Unknown research case:'))) {
      notFound()
    }

    throw error
  }
}

async function loadPersonalResearchCase(caseId: string, ledgerPath: string | undefined, sourceLedgerPath: string | undefined) {
  if (ledgerPath === undefined) {
    notFound()
  }

  const store = new SQLiteEventStore(ledgerPath ?? resolveDemoLedgerPath())
  try {
    return await getAppResearchCaseFromStore(store, 'personal-local', caseId, sourceLedgerPath)
  } finally {
    store.close()
  }
}
