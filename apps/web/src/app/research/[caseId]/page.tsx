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
      : await loadPersonalResearchCase(caseId, state.config.ledger_path)

    return (
      <main style={{ color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
        <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
          <p style={{ margin: '0 0 1rem' }}>
            <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
              ← Back to command center
            </a>
          </p>
          <ResearchCasePanel researchCase={researchCase} mode={state.config.mode} />
        </div>
      </main>
    )
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('Unknown demo research case:') || error.message.startsWith('Unknown research case:'))) {
      notFound()
    }

    throw error
  }
}

async function loadPersonalResearchCase(caseId: string, ledgerPath: string | undefined) {
  if (ledgerPath === undefined) {
    notFound()
  }

  const store = new SQLiteEventStore(ledgerPath ?? resolveDemoLedgerPath())
  try {
    return await getAppResearchCaseFromStore(store, 'personal-local', caseId)
  } finally {
    store.close()
  }
}
