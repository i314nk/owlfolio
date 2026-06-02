import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { AccountingMonthlyReport } from '../../../components/AccountingMonthlyReport'
import { buildMonthlyAccountingReport, getAccountingReportFromStore } from '../../../lib/accounting'
import { getDemoEvents } from '../../../lib/demo'
import { getOnboardingState, type OnboardingState } from '../../../lib/onboarding'

export default async function AccountingMonthlyPage() {
  const state = await getOnboardingState()
  const report = await loadAccountingReport(state)

  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <AccountingMonthlyReport report={report} />
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
