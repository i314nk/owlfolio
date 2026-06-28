import { notFound } from 'next/navigation'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { resolveCurrentPrice } from '@owlfolio/workflow/marketData'
import type { MoatClass } from '@owlfolio/strategies/strategyContract'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'

import { ResearchCaseActions } from './ResearchCaseActions'
import { ResearchCasePanel } from '../../../components/ResearchCasePanel'
import { ResearchCasePending } from '../../../components/ResearchCasePending'
import { ResearchRunProgress } from '../../../components/ResearchRunProgress'
import { UnconfiguredNotice } from '../../../components/UnconfiguredNotice'
import { resolveRunProgress } from '../../../lib/researchRunProgress'
import { buildPositionPlan, type PositionPlan } from '../../../lib/positionPlan'
import { getDemoResearchCase, resolveDemoLedgerPath } from '../../../lib/demo'
import { isUnconfiguredForUser } from '../../../lib/modeView'
import { getOnboardingState } from '../../../lib/onboarding'
import { getInvestableCapital, resolveResearchCaseView } from '../../../lib/workflow'
import type { AppResearchCase, ResearchCaseView } from '../../../lib/workflow'
import type { MarketQuote } from '../../../components/ResearchCasePanel'

const INVESTABLE_MOAT_CLASSES: ReadonlySet<string> = new Set(['wide', 'monopoly'])

export type ResearchCasePageProps = {
  params: Promise<{ caseId: string }>
}

export default async function ResearchCasePage({ params }: ResearchCasePageProps) {
  const { caseId } = await params
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return <UnconfiguredNotice feature="Research case" />
  }

  try {
    let researchCase: AppResearchCase
    if (state.config.mode === 'demo') {
      researchCase = await getDemoResearchCase(caseId)
    } else {
      // Personal-local: tolerate the post-start race where the web path has appended
      // `research_run_requested` but the WORKER has not yet authored `research_case_created`.
      const view = await loadPersonalResearchCaseView(caseId, state.config.ledger_path, state.config.source_ledger_path)
      if (view.status === 'unknown') {
        notFound()
      }
      if (view.status === 'pending') {
        return (
          <main className="owl-route-frame owl-route-frame-narrow">
            <p className="owl-route-back-row">
              <a className="owl-back-link owl-focusable" href="/">
                ← Back to command center
              </a>
            </p>
            <ResearchCasePending caseId={caseId} />
          </main>
        )
      }
      if (view.status === 'failed') {
        return (
          <main className="owl-route-frame owl-route-frame-narrow">
            <p className="owl-route-back-row">
              <a className="owl-back-link owl-focusable" href="/">
                ← Back to command center
              </a>
            </p>
            <section className="owl-section-card">
              <p className="owl-empty-state-kicker">Research run failed</p>
              <h2 className="owl-section-title">This research run did not complete</h2>
              <p className="owl-empty-state-description">
                The research worker reported a failure for <code>{caseId}</code>
                {view.error_summary === undefined ? '.' : `: ${view.error_summary}`} You can start a new
                research case from the command center.
              </p>
            </section>
          </main>
        )
      }
      researchCase = view.researchCase

      // Mid-run gate: the case row exists (`ready`) but the multi-minute deep dive (quick-screen → circle →
      // 7 lanes → synthesis → decision) is still running. Drive an animated, stage-aware "research running…"
      // view off the projected stage + specialist findings until the run reaches a terminal/awaiting-approval
      // state, at which point we fall through to the dossier / approval rendering. (Demo cases are seeded
      // terminal, so demo mode never reaches this branch — no demo wiring needed.)
      const progress = resolveRunProgress({
        stage: researchCase.stage,
        specialistFindingCount: researchCase.specialist_findings?.length ?? 0,
      })
      if (progress.inProgress) {
        return (
          <main className="owl-route-frame owl-route-frame-narrow">
            <p className="owl-route-back-row">
              <a className="owl-back-link owl-focusable" href="/">
                ← Back to command center
              </a>
            </p>
            <ResearchRunProgress
              caseId={caseId}
              initial={progress}
              {...(researchCase.ticker !== undefined ? { ticker: researchCase.ticker } : {})}
            />
          </main>
        )
      }
    }

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

    // Engine-version staleness (mirror buildEngineVersionMarker): a run is STALE when its engine_version
    // is absent (pre-versioning) or differs from the current ENGINE_VERSION. Drives the re-run emphasis.
    const caseEngineVersion = researchCase.valuation?.judgment?.engine_version
    const engineStale = caseEngineVersion === undefined || caseEngineVersion !== ENGINE_VERSION

    return (
      <main className="owl-route-frame">
        <p className="owl-route-back-row">
          <a className="owl-back-link owl-focusable" href="/">
            ← Back to command center
          </a>
        </p>
        {state.config.mode === 'personal-local' ? (
          <ResearchCaseActions
            caseId={caseId}
            ticker={researchCase.ticker}
            isArchived={researchCase.archived === true}
            engineStale={engineStale}
          />
        ) : null}
        {researchCase.archived === true ? (
          <p
            data-testid="research-case-archived-marker"
            style={{
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-2xs)',
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--owl-color-quiet)',
              margin: '0 0 var(--owl-space-3)',
            }}
          >
            Archived — hidden from the active research library and pipeline. Still in the ledger.
          </p>
        ) : null}
        <ResearchCasePanel
          researchCase={researchCase}
          mode={state.config.mode}
          configuredProviderId={state.config.provider.provider_id}
          {...(state.config.savings !== undefined ? { savings: state.config.savings } : {})}
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

async function loadPersonalResearchCaseView(
  caseId: string,
  ledgerPath: string | undefined,
  sourceLedgerPath: string | undefined,
): Promise<ResearchCaseView> {
  if (ledgerPath === undefined) {
    notFound()
  }

  const store = new SQLiteEventStore(ledgerPath ?? resolveDemoLedgerPath())
  try {
    return await resolveResearchCaseView(store, 'personal-local', caseId, sourceLedgerPath)
  } finally {
    store.close()
  }
}
