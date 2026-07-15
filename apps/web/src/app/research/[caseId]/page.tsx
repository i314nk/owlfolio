import { notFound } from 'next/navigation'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { resolveCurrentPrice } from '@owlfolio/workflow/marketData'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'

import { ResearchCaseActions } from './ResearchCaseActions'
import { StartResearchButton } from './StartResearchButton'
import { ResearchCasePanel } from '../../../components/ResearchCasePanel'
import { ResearchCasePending } from '../../../components/ResearchCasePending'
import { ResearchRunProgress } from '../../../components/ResearchRunProgress'
import { UnconfiguredNotice } from '../../../components/UnconfiguredNotice'
import { resolveRunProgress } from '../../../lib/researchRunProgress'
import { isUnconfiguredForUser } from '../../../lib/modeView'
import { getOnboardingState } from '../../../lib/onboarding'
import { resolveResearchCaseView, type ResearchCaseView } from '../../../lib/workflow'
import type { MarketQuote } from '../../../components/ResearchCasePanel'


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
    // Personal-local: tolerate the post-start race where the web path has appended
    // `research_run_requested` but the WORKER has not yet authored `research_case_created`.
    const { view, events } = await loadPersonalResearchCaseView(caseId, state.config.ledger_path, state.config.source_ledger_path)
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
          {/* Re-run + archive for the failed run: reuses the dossier's actions (the re-run supersedes
              this failed case, so it drops out of active views once the fresh run lands). Rendered only
              when the ticker is recoverable — without it a re-run cannot be keyed. */}
          {view.ticker !== undefined ? (
            <ResearchCaseActions caseId={caseId} ticker={view.ticker} isArchived={false} engineStale={false} />
          ) : null}
          <section className="owl-section-card">
            <p className="owl-empty-state-kicker">Research run failed</p>
            <h2 className="owl-section-title">This research run did not complete</h2>
            <p className="owl-empty-state-description">
              The research worker reported a failure for <code>{caseId}</code>
              {view.error_summary === undefined ? '.' : `: ${view.error_summary}`}{' '}
              {view.ticker !== undefined
                ? 'Use “Re-run on current engine” above to start a fresh run for this ticker, or start a new research case from the command center.'
                : 'You can start a new research case from the command center.'}
            </p>
          </section>
        </main>
      )
    }
    const researchCase = view.researchCase

    // Check whether a run has been requested for this case. A discovery-promoted case has a
    // `research_case_created` event (stage 'discovered') but NO `research_run_requested` event —
    // without this check, `resolveRunProgress` maps stage='discovered' to inProgress:true and the
    // page shows a permanent spinner. Render "Ready to research" instead.
    const runRequested = events.some(
      (e) =>
        (e.event_type === 'research_run_requested' || e.event_type === 'research_run_claimed') &&
        (String((e.payload as Record<string, unknown> | undefined)?.['research_case_id'] ?? e.aggregate_id) === caseId),
    )
    if (researchCase.stage === 'discovered' && !runRequested) {
      return (
        <main className="owl-route-frame owl-route-frame-narrow">
          <p className="owl-route-back-row">
            <a className="owl-back-link owl-focusable" href="/">
              ← Back to command center
            </a>
          </p>
          <section className="owl-section-card">
            <p className="owl-empty-state-kicker">Ready to research</p>
            <h2 className="owl-section-title">{researchCase.ticker ?? caseId}</h2>
            <p className="owl-empty-state-description">This candidate hasn&apos;t been analyzed yet.</p>
            <StartResearchButton caseId={caseId} />
          </section>
        </main>
      )
    }

    // Mid-run gate: the case row exists (`ready`) but the multi-minute deep dive (quick-screen → circle →
    // 5 lanes → synthesis → decision) is still running. Drive an animated, stage-aware "research running…"
    // view off the projected stage + specialist findings until the run reaches a terminal/awaiting-approval
    // state, at which point we fall through to the dossier / approval rendering.
    const progress = resolveRunProgress({
      stage: researchCase.stage,
      specialistFindingCount: researchCase.specialist_findings?.length ?? 0,
      shariahGateDisabled: (researchCase.shariah_gate?.sector_status ?? '').toUpperCase() === 'DISABLED',
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

    // SCALE-DOWN S1: the position plan is removed — zones tell you when; the size is yours.

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
        <ResearchCaseActions
          caseId={caseId}
          ticker={researchCase.ticker}
          isArchived={researchCase.archived === true}
          engineStale={engineStale}
          moatGated={researchCase.moat_gate_short_circuited === true}
        />
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
        />
      </main>
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown research case:')) {
      notFound()
    }

    throw error
  }
}

async function loadPersonalResearchCaseView(
  caseId: string,
  ledgerPath: string | undefined,
  sourceLedgerPath: string | undefined,
): Promise<{ view: ResearchCaseView; events: LedgerEventEnvelope<unknown>[] }> {
  if (ledgerPath === undefined) {
    notFound()
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    // Read events once for the runRequested check; resolveResearchCaseView reads them again internally.
    const events = await store.list()
    const view = await resolveResearchCaseView(store, 'personal-local', caseId, sourceLedgerPath)
    return { view, events }
  } finally {
    store.close()
  }
}
