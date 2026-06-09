import { notFound } from 'next/navigation'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { resolveCurrentPrice } from '@owlfolio/workflow/marketData'

import { ResearchCasePanel } from '../../../components/ResearchCasePanel'
import { getDemoResearchCase, resolveDemoLedgerPath } from '../../../lib/demo'
import { getOnboardingState } from '../../../lib/onboarding'
import { getAppResearchCaseFromStore } from '../../../lib/workflow'
import type { MarketQuote } from '../../../components/ResearchCasePanel'

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

    // Fetch a live market quote server-side when the case has a ticker and a buy-below price.
    // Skip under playwright test mode so e2e is deterministic (no live network call).
    let marketQuote: MarketQuote | undefined
    const isTestMode = process.env.OWLFOLIO_TEST_MODE === 'playwright'
    if (!isTestMode && researchCase.ticker !== undefined && researchCase.valuation?.buy_price_per_share !== undefined) {
      try {
        const quote = await resolveCurrentPrice({ ticker: researchCase.ticker })
        if (quote.available) {
          marketQuote = {
            price_per_share: quote.price_per_share,
            currency: quote.currency,
            as_of: quote.as_of,
            source: quote.source,
          }
        }
      } catch {
        // fail-closed: unavailable quote → no market tick rendered
      }
    }

    return (
      <main className="owl-route-frame">
        <p className="owl-route-back-row">
          <a className="owl-back-link owl-focusable" href="/">
            ← Back to command center
          </a>
        </p>
        <ResearchCasePanel researchCase={researchCase} mode={state.config.mode} {...(marketQuote !== undefined ? { marketQuote } : {})} />
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
