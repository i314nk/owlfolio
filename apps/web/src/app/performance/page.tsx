import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { fetchPriceHistory } from '@owlfolio/workflow/marketData'
import type { PerformanceBenchmarkPoint } from '@owlfolio/workflow/performanceProjection'

import { PerformancePanel } from '../../components/PerformancePanel'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { getDemoEvents } from '../../lib/demo'
import { isUnconfigured } from '../../lib/modeView'
import { getOnboardingState, type OnboardingState } from '../../lib/onboarding'
import {
  buildPerformanceReport,
  DEFAULT_BENCHMARK_SYMBOL,
  getPerformanceReportFromStore,
  type AppPerformanceReport,
} from '../../lib/performance'

export default async function PerformancePage() {
  const state = await getOnboardingState()
  if (isUnconfigured(state.config)) {
    return <UnconfiguredNotice feature="Performance" />
  }
  const benchmarkSeries = await loadBenchmarkSeries()
  const report = await loadPerformanceReport(state, benchmarkSeries)

  return (
    <main className="owl-route-frame owl-route-frame-wide">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <PerformancePanel report={report} />
    </main>
  )
}

/**
 * Fetch the default Shariah benchmark (SPUS) daily series. Skipped under
 * playwright test mode so e2e renders the deterministic benchmark-pending state.
 */
async function loadBenchmarkSeries(): Promise<PerformanceBenchmarkPoint[] | undefined> {
  if (process.env.OWLFOLIO_TEST_MODE === 'playwright') {
    return undefined
  }

  const result = await fetchPriceHistory({ ticker: DEFAULT_BENCHMARK_SYMBOL }, { range: '2y', interval: '1d' })
  if (!result.available) {
    return undefined
  }
  return result.points
}

async function loadPerformanceReport(
  state: OnboardingState,
  benchmarkSeries: PerformanceBenchmarkPoint[] | undefined,
): Promise<AppPerformanceReport> {
  if (state.config.mode === 'demo') {
    return buildPerformanceReport(await getDemoEvents(), benchmarkSeries)
  }

  if (state.config.ledger_path === undefined) {
    return buildPerformanceReport([], benchmarkSeries)
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await getPerformanceReportFromStore(store, benchmarkSeries)
  } finally {
    store.close()
  }
}
