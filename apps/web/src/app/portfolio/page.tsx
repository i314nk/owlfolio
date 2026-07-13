import { findLatestResearchCaseForTicker, projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PortfolioPanel, type PortfolioHolding } from '../../components/PortfolioPanel'
import { RefreshPricesButton } from '../../components/RefreshPricesButton'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'
import { projectMonitorAlerts } from '@owlfolio/ledger/projections/monitorAlertProjection'

import { getAppHoldingsFromStore, type MonitorAlert, type WorkflowMode } from '../../lib/workflow'
import { resolveBusinessFindings } from '../../lib/checklistEvidence'

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
        // The ladder anchors (IV + rule-8 load-up) ride along so the holding row can render the
        // small decision-card view.
        const iv = (valuationCase?.valuation as { intrinsic_value_per_share?: number } | undefined)?.intrinsic_value_per_share
        if (iv !== undefined) enriched.intrinsicValuePerShare = iv
        const loadUp = (valuationCase?.valuation as { load_up_below?: number } | undefined)?.load_up_below
        if (loadUp !== undefined) enriched.loadUpBelow = loadUp
      }
      const entityName = (valuationCase ?? linkedCase)?.entity_name
      if (entityName !== undefined) enriched.entityName = entityName
      return enriched
    })
    return { holdings: enrichedHoldings, alerts }
  } finally {
    store.close()
  }
}
