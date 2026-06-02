import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { AccountingMonthlyReport } from '../../../components/AccountingMonthlyReport'
import { buildMonthlyAccountingReport, getAccountingReportFromStore } from '../../../lib/accounting'
import { getDemoEvents } from '../../../lib/demo'
import { getOnboardingState, type OnboardingState } from '../../../lib/onboarding'

export default async function AccountingMonthlyPage() {
  const state = await getOnboardingState()
  const report = await loadAccountingReport(state)

  return (
    <main style={{ color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
      <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
        <p style={{ margin: '0 0 1rem' }}>
          <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
            ← Back to command center
          </a>
        </p>
        <AccountingMonthlyReport report={report} />
      </div>
    </main>
  )
}

async function loadAccountingReport(state: OnboardingState) {
  if (state.config.mode === 'demo') {
    return buildMonthlyAccountingReport(await getDemoEvents())
  }

  if (state.config.ledger_path === undefined) {
    return buildMonthlyAccountingReport([])
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await getAccountingReportFromStore(store)
  } finally {
    store.close()
  }
}
