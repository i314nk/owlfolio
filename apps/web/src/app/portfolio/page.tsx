import { findLatestResearchCaseForTicker, projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PortfolioPanel, type PortfolioHolding } from '../../components/PortfolioPanel'
import { RefreshPricesButton } from '../../components/RefreshPricesButton'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'
import { projectMonitorAlerts } from '@owlfolio/ledger/projections/monitorAlertProjection'

import { getAppHoldingsFromStore, type MonitorAlert, type WorkflowMode } from '../../lib/workflow'

export default async function PortfolioPage() {
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return <UnconfiguredNotice feature="Portfolio" />
  }
  const { holdings, alerts } = await loadHoldings(state.config.ledger_path, state.config.mode)

  return (
    <main className="owl-route-frame owl-route-frame-wide">
      {/* div, not p: RefreshPricesButton renders a <div>, and <p> cannot contain block elements. */}
      <div className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
        <RefreshPricesButton />
      </div>
      <PortfolioPanel
        holdings={holdings}
        mode={state.config.mode}
        alerts={alerts}
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
      // OWNER-LOCKED (2026-07-14): the row DISPLAYS from the latest non-superseded case for the
      // ticker — thresholds are provider observations, and a superseding re-run must show up here.
      // The holding's own research_case_id stays as the frozen audit pointer; a latest case with no
      // valuation renders honestly (entry-vs-market chip, latest-verdict line) instead of silently
      // keeping the superseded numbers.
      const linkedCase = researchCasesById.get(holding.research_case_id)
      const valuationCase = (holding.ticker === undefined ? undefined : findLatestResearchCaseForTicker(events, holding.ticker)) ?? linkedCase
      const buyBelow = valuationCase?.valuation?.buy_price_per_share

      const enriched: PortfolioHolding = { ...holding }
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
        // The ladder anchors (IV + rule-8 load-up) ride along so the holding row can render the
        // small decision-card view.
        const iv = (valuationCase?.valuation as { intrinsic_value_per_share?: number } | undefined)?.intrinsic_value_per_share
        if (iv !== undefined) enriched.intrinsicValuePerShare = iv
        const loadUp = (valuationCase?.valuation as { load_up_below?: number } | undefined)?.load_up_below
        if (loadUp !== undefined) enriched.loadUpBelow = loadUp
      }
      const entityName = (valuationCase ?? linkedCase)?.entity_name
      if (entityName !== undefined) enriched.entityName = entityName
      if (valuationCase !== undefined) {
        enriched.displayResearchCaseId = valuationCase.research_case_id
        if (valuationCase.investment_verdict !== undefined) enriched.latestAnalysisVerdict = valuationCase.investment_verdict
        enriched.latestAnalysisAt = valuationCase.updated_at
        if (valuationCase.thesis_summary !== undefined) enriched.latestAnalysisThesis = valuationCase.thesis_summary
      }
      return enriched
    })
    return { holdings: enrichedHoldings, alerts }
  } finally {
    store.close()
  }
}
