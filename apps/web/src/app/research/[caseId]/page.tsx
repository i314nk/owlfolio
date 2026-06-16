import { notFound } from 'next/navigation'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { resolveCurrentPrice } from '@owlfolio/workflow/marketData'
import type { MoatClass } from '@owlfolio/strategies/strategyContract'

import { ResearchCasePanel } from '../../../components/ResearchCasePanel'
import { UnconfiguredNotice } from '../../../components/UnconfiguredNotice'
import { buildPositionPlan, type PositionPlan } from '../../../lib/positionPlan'
import { getDemoResearchCase, resolveDemoLedgerPath } from '../../../lib/demo'
import { isUnconfigured } from '../../../lib/modeView'
import { getOnboardingState } from '../../../lib/onboarding'
import { getAppResearchCaseFromStore, getInvestableCapital } from '../../../lib/workflow'
import type { MarketQuote } from '../../../components/ResearchCasePanel'

const INVESTABLE_MOAT_CLASSES: ReadonlySet<string> = new Set(['wide', 'monopoly'])

export type ResearchCasePageProps = {
  params: Promise<{ caseId: string }>
}

export default async function ResearchCasePage({ params }: ResearchCasePageProps) {
  const { caseId } = await params
  const state = await getOnboardingState()
  if (isUnconfigured(state.config)) {
    return <UnconfiguredNotice feature="Research case" />
  }

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

    // Advisory position plan: only when the case has an investable moat + a buy price.
    // When investable capital is set, compute the draft plan; otherwise flag a prompt so
    // the panel can nudge the user to set capital on the Portfolio page.
    const moatClass = researchCase.valuation?.moat_class
    const buyPrice = researchCase.valuation?.buy_price_per_share
    const moatIsInvestable = moatClass !== undefined && INVESTABLE_MOAT_CLASSES.has(moatClass)

    let positionPlan: PositionPlan | undefined
    let promptForCapital = false
    if (moatIsInvestable && buyPrice !== undefined && state.config.mode === 'personal-local') {
      const investableCapital = await getInvestableCapital(state.config.ledger_path)
      if (investableCapital !== undefined) {
        positionPlan = buildPositionPlan({
          moatClass: moatClass as MoatClass,
          buyPricePerShare: buyPrice,
          investableCapital: investableCapital.amount,
        })
      } else {
        promptForCapital = true
      }
    }

    return (
      <main className="owl-route-frame">
        <p className="owl-route-back-row">
          <a className="owl-back-link owl-focusable" href="/">
            ← Back to command center
          </a>
        </p>
        <ResearchCasePanel
          researchCase={researchCase}
          mode={state.config.mode}
          {...(marketQuote !== undefined ? { marketQuote } : {})}
          {...(positionPlan !== undefined ? { positionPlan } : {})}
          promptForCapital={promptForCapital}
        />
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
