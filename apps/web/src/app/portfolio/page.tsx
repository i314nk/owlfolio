import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PortfolioPanel, type PortfolioValuationRefreshSummary } from '../../components/PortfolioPanel'
import { getOnboardingState } from '../../lib/onboarding'
import { getAppHoldingsFromStore, type AppHolding } from '../../lib/workflow'

export default async function PortfolioPage() {
  const state = await getOnboardingState()
  const holdings = await loadHoldings(state.config.ledger_path, state.config.mode)
  const valuationRefresh = buildValuationRefreshSummary(holdings)

  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <PortfolioPanel holdings={holdings} mode={state.config.mode} valuationRefresh={valuationRefresh} />
    </main>
  )
}

async function loadHoldings(ledgerPath: string | undefined, mode: 'demo' | 'personal-local') {
  if (ledgerPath === undefined && mode === 'personal-local') {
    return []
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    return await getAppHoldingsFromStore(store, mode)
  } finally {
    store.close()
  }
}

function buildValuationRefreshSummary(holdings: AppHolding[]): PortfolioValuationRefreshSummary {
  const priceChecks = holdings
    .map((holding) => holding.latest_price_checked_at)
    .filter((checkedAt): checkedAt is string => checkedAt !== undefined)
    .sort()
  const missing = holdings
    .filter((holding) => holding.latest_price_checked_at === undefined)
    .map((holding) => holding.ticker ?? holding.company_id ?? holding.holding_id)

  const lastPriceCheckAt = priceChecks.at(-1)
  const summary: PortfolioValuationRefreshSummary = {
    next_scheduled_check: '0 7 * * 1-5',
    data_source: 'mock-local-price-feed',
    confidence_caveat: 'Mock/local confidence — deterministic prices for local workflow verification.',
    holdings_missing_data: missing,
  }
  if (lastPriceCheckAt !== undefined) {
    summary.last_price_check_at = lastPriceCheckAt
  }
  return summary
}
