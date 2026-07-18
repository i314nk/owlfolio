import { projectPipeline } from '@owlfolio/ledger/projections/pipelineProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { resolveLocale } from '@owlfolio/shared'

import { RouteHeader } from '../../../../components/designSystem'
import { UnconfiguredNotice } from '../../../../components/UnconfiguredNotice'
import { t } from '../../../../lib/i18n'
import { isUnconfiguredForUser } from '../../../../lib/modeView'
import { getOnboardingState } from '../../../../lib/onboarding'
import { runLogTailsForWindow } from '../../../../lib/runLogs'

export const dynamic = 'force-dynamic'

// The window's worker task kinds: a research case runs through the front-gates spawn and the
// deep-dive spawn; discovery harvests never belong to a case run.
const RUN_TASK_KINDS = ['process_research_queue', 'process_deep_dive_queue'] as const

/**
 * Per-run worker-log diagnostics (owner-requested 2026-07-18): each pipeline run — active, done, or
 * failed — links here; the page shows the stdout/stderr of the worker processes from THAT run's time
 * window (redacted in runLogs.ts before anything leaves the server). The ledger stays the source of
 * truth; these are process-level diagnostics with a 14-day retention.
 */
export default async function PipelineRunLogPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return <UnconfiguredNotice feature="Pipeline run log" />
  }
  const locale = resolveLocale(state.config.language)
  const store = new SQLiteEventStore(state.config.ledger_path)

  try {
    const events = await store.list()
    const pipeline = projectPipeline(events)
    const run = pipeline.runs.find((r) => r.research_case_id === caseId)
    const failed = (pipeline.failed_runs ?? []).find((r) => r.case_id === caseId)
    const ticker = run?.ticker ?? failed?.ticker ?? caseId
    const isLive = run !== undefined && (run.status === 'running' || run.status === 'awaiting_approval')

    // The run's log window: from just before it started (or a generous hour before a failure whose
    // start the faults projection does not carry) until shortly after its last recorded movement —
    // open-ended while it is still live.
    const sinceMs = run !== undefined
      ? Date.parse(run.started_at) - 60_000
      : failed !== undefined
        ? Date.parse(failed.failed_at) - 60 * 60 * 1000
        : undefined
    const untilMs = run !== undefined
      ? (isLive ? undefined : Date.parse(run.updated_at) + 5 * 60 * 1000)
      : failed !== undefined
        ? Date.parse(failed.failed_at) + 5 * 60 * 1000
        : undefined

    const logs = sinceMs === undefined
      ? []
      : await runLogTailsForWindow({ sinceMs, ...(untilMs === undefined ? {} : { untilMs }), taskKinds: RUN_TASK_KINDS }, 32_768)

    return (
      <main className="owl-route-frame owl-route-frame-wide">
        <p className="owl-route-back-row">
          <a className="owl-back-link owl-focusable" href={`/pipeline?case=${encodeURIComponent(caseId)}`}>
            ← Back to the pipeline
          </a>
        </p>
        <RouteHeader
          kicker={t(locale, 'pp_log_accent')}
          title={`${t(locale, 'pp_log_title')} — ${ticker}`}
          description={t(locale, 'pp_log_note')}
        />
        <hr className="owl-rule" />
        {logs.length === 0 ? (
          <section aria-label="No worker log" className="owl-section-card">
            <p className="owl-body" style={{ margin: 0 }}>{t(locale, 'pp_log_none')}</p>
          </section>
        ) : (
          logs.map((log) => (
            <section key={log.file} aria-label={log.file} className="owl-section-card" style={{ gap: 'var(--owl-space-2)' }}>
              <p style={{ color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', margin: 0 }}>{log.file}</p>
              <pre
                style={{
                  background: 'var(--owl-color-panel)',
                  border: '1px solid var(--owl-color-border)',
                  borderRadius: 'var(--owl-radius-card)',
                  color: 'var(--owl-color-muted)',
                  fontFamily: 'var(--owl-font-mono)',
                  fontSize: 'var(--owl-text-2xs)',
                  lineHeight: 1.5,
                  margin: 0,
                  maxHeight: '38rem',
                  overflow: 'auto',
                  padding: '0.7rem 0.85rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {log.tail}
              </pre>
            </section>
          ))
        )}
      </main>
    )
  } finally {
    store.close()
  }
}
