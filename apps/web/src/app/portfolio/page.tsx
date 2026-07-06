import { findLatestResearchCaseForTicker, projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PortfolioPanel, type PortfolioHolding, type PortfolioValuationRefreshSummary } from '../../components/PortfolioPanel'
import { RefreshPricesButton } from '../../components/RefreshPricesButton'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'
import { humanizeCron } from '../../lib/schedule'
import { projectMonitorAlerts } from '@owlfolio/ledger/projections/monitorAlertProjection'

import { getAppHoldingsFromStore, getInvestableCapital, type MonitorAlert, type WorkflowMode } from '../../lib/workflow'
import { resolveBusinessFindings } from '../../lib/checklistEvidence'

export default async function PortfolioPage() {
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return <UnconfiguredNotice feature="Portfolio" />
  }
  const { holdings, alerts } = await loadHoldings(state.config.ledger_path, state.config.mode)
  const valuationRefresh = buildValuationRefreshSummary(holdings)
  const investableCapital = await getInvestableCapital(state.config.ledger_path)

  return (
    <main className="owl-route-frame owl-route-frame-wide">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
        <RefreshPricesButton />
      </p>
      <PortfolioPanel
        holdings={holdings}
        mode={state.config.mode}
        valuationRefresh={valuationRefresh}
        alerts={alerts}
        {...(investableCapital !== undefined ? { investableCapital } : {})}
      />
    </main>
  )
}

// `mode` is the full WorkflowMode for type-safety, but the page short-circuits unconfigured before
// calling this, so in practice only 'personal-local' reaches here.
async function loadHoldings(ledgerPath: string | undefined, mode: WorkflowMode): Promise<{ holdings: PortfolioHolding[]; alerts: MonitorAlert[] }> {
  if (ledgerPath === undefined) {
    return { holdings: [], alerts: [] }
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    const holdings = await getAppHoldingsFromStore(store, mode)
    const events = await store.list()
    const alerts = projectMonitorAlerts(events)
    const researchCasesById = new Map(
      projectResearchCases(events).map((researchCase) => [researchCase.research_case_id, researchCase]),
    )

    const enrichedHoldings = holdings.map((holding) => {
      // Prefer the holding's own linked research case; fall back to the latest
      // non-superseded case for the same ticker when that case has no valuation.
      const linkedCase = researchCasesById.get(holding.research_case_id)
      const linkedBuyBelow = linkedCase?.valuation?.buy_price_per_share
      const valuationCase = linkedBuyBelow !== undefined && linkedCase !== undefined
        ? linkedCase
        : (holding.ticker === undefined ? undefined : findLatestResearchCaseForTicker(events, holding.ticker)) ?? linkedCase
      const buyBelow = valuationCase?.valuation?.buy_price_per_share

      const enriched: PortfolioHolding = { ...holding }
      // Marshal the re-underwrite business findings as a PURE read of the held name's research-case
      // projection (the holding's linked case, with the valuation fallback). No engine call. The forms
      // render these read-only (audit-and-decide); the server independently recomputes them at sign-off.
      const findingsCase = valuationCase ?? linkedCase
      enriched.reviewBusinessFindings = resolveBusinessFindings(findingsCase)
      if (buyBelow !== undefined) {
        enriched.buyBelowPricePerShare = buyBelow
        const moatClass = valuationCase?.valuation?.moat_class
        if (moatClass !== undefined) {
          enriched.moatClass = moatClass
        }
        const discountRate = valuationCase?.valuation?.discount_rate
        if (discountRate !== undefined) {
          enriched.hurdleRate = discountRate
        }
      }
      return enriched
    })
    return { holdings: enrichedHoldings, alerts }
  } finally {
    store.close()
  }
}

function buildValuationRefreshSummary(holdings: PortfolioHolding[]): PortfolioValuationRefreshSummary {
  const priceChecks = holdings
    .map((holding) => holding.latest_price_checked_at)
    .filter((checkedAt): checkedAt is string => checkedAt !== undefined)
    .sort()
  const missing = holdings
    .filter((holding) => holding.latest_price_checked_at === undefined)
    .map((holding) => holding.ticker ?? holding.company_id ?? holding.holding_id)

  const lastPriceCheckAt = priceChecks.at(-1)
  const hasPriceCheck = lastPriceCheckAt !== undefined
  const summary: PortfolioValuationRefreshSummary = {
    next_scheduled_check: humanizeCron('0 7 * * 1-5'),
    data_source: hasPriceCheck ? 'mock-local-price-feed' : 'awaiting-first-price-check',
    confidence_caveat: hasPriceCheck
      ? 'Mock/local confidence — deterministic prices for local workflow verification.'
      : 'No price check has run yet — record a manual valuation snapshot or wait for the scheduled check.',
    holdings_missing_data: missing,
  }
  if (lastPriceCheckAt !== undefined) {
    summary.last_price_check_at = lastPriceCheckAt
  }
  return summary
}
