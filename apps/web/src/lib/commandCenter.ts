import {
  projectCommandCenterSummary,
  type CommandCenterApprovalQueueItem,
  type CommandCenterRecentActivity,
} from '@owlfolio/ledger/projections/commandCenterProjection'
import { projectMonitorAlerts, type MonitorAlert } from '@owlfolio/ledger/projections/monitorAlertProjection'
import {
  extractDiscoverySignal,
  projectDiscoveryCandidates,
  type DiscoverySignal,
} from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { AppConfig } from '@owlfolio/shared'
import { mergeAutomationSettings } from '@owlfolio/shared'
import { projectScheduledTasks } from '@owlfolio/ledger/projections/scheduledTaskProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'

import { isUnconfiguredForUser } from './modeView'
import { resolveDutiesDue, type DutyDue } from './dutiesDue'
import { buildProviderStatusRows, type ProviderStatusRow } from './providerStatus'

export type PipelineCounts = {
  research_cases: number
  watchlist_drafts: number
  confirmed_watchlist_items: number
  open_holdings: number
  pending_user_actions: number
}

export type CommandCenterAction = {
  href: string
  label: string
}


/** A strong discovery signal surfaced on the home "needs your attention" rail (CLUSTER_BUY especially). */
export type CommandCenterDiscoverySignal = {
  candidate_id: string
  ticker: string
  company_name: string
  signal: DiscoverySignal
  href: string
}

export type AppCommandCenter = {
  product_name: string
  setup_status: string
  provider_status: string
  strategy_status: string
  shariah_status: string
  ledger_status: string
  pipeline_counts: PipelineCounts
  next_recommended_action: string
  approval_queue: CommandCenterApprovalQueueItem[]
  recent_activity: CommandCenterRecentActivity[]
  /** Open agent observations + human-decision drafts (NOT executed) — the "needs your attention" rail. */
  monitor_alerts: MonitorAlert[]
  /** The strongest unconverted 13F discovery signals (CLUSTER_BUY first). */
  discovery_signals: CommandCenterDiscoverySignal[]
  /** Cadence duties whose time has come (13F harvest / quarterly check-in / annual re-analysis). */
  duties_due: DutyDue[]
  primary_action: CommandCenterAction
  secondary_action?: CommandCenterAction
}

export type { MonitorAlert } from '@owlfolio/ledger/projections/monitorAlertProjection'

const SIGNAL_RANK: Record<DiscoverySignal['signal_type'], number> = { CLUSTER_BUY: 0, NEW_POSITION: 1, MEANINGFUL_ADD: 2 }

/**
 * The strongest still-actionable discovery signals for the home rail: candidates that have surfaced but
 * not yet been promoted/rejected, ranked CLUSTER_BUY > NEW_POSITION > MEANINGFUL_ADD then by conviction.
 */
function buildDiscoverySignals(events: LedgerEventEnvelope<unknown>[], limit = 3): CommandCenterDiscoverySignal[] {
  const out: CommandCenterDiscoverySignal[] = []
  for (const candidate of projectDiscoveryCandidates(events)) {
    if (candidate.status === 'rejected' || candidate.status === 'duplicate' || candidate.status === 'promoted_to_research_case') {
      continue
    }
    const signal = extractDiscoverySignal(candidate.discovery_metadata)
    if (signal === undefined) {
      continue
    }
    out.push({
      candidate_id: candidate.candidate_id,
      ticker: candidate.ticker,
      company_name: candidate.company_name,
      signal,
      href: `/research/new?ticker=${encodeURIComponent(candidate.ticker)}`,
    })
  }
  return out
    .sort((left, right) => {
      const byKind = SIGNAL_RANK[left.signal.signal_type] - SIGNAL_RANK[right.signal.signal_type]
      return byKind !== 0 ? byKind : right.signal.conviction_pct - left.signal.conviction_pct
    })
    .slice(0, limit)
}

export type SetupAwareCommandCenterInput = {
  config: AppConfig
  is_initialized: boolean
  provider_status_rows?: ProviderStatusRow[]
  store?: EventStore
  env?: { readonly [key: string]: string | undefined }
}

/** The stages that carry a recorded decision — the quarterly check-in's re-review targets. */
const DECIDED_STAGES = new Set(['decision_drafted', 'watchlist', 'holding', 'rejected', 'pass'])

/**
 * The cadence-duty nudges: the alpha has no autonomous scheduler, so the command center tells the
 * user when a configured rhythm (13F harvest / quarterly check-in / annual re-analysis) has lapsed.
 */
function buildDutiesDue(events: LedgerEventEnvelope<unknown>[], config: AppConfig): DutyDue[] {
  return resolveDutiesDue({
    now: new Date(),
    automation: mergeAutomationSettings(config.automation),
    tasks: projectScheduledTasks(events).map((task) => ({
      task_kind: task.task_kind,
      last_completed_at: task.last_completed_at,
    })),
    decided_case_count: projectResearchCases(events)
      .filter((c) => c.superseded !== true && DECIDED_STAGES.has(c.stage)).length,
    open_holding_count: projectHoldings(events).length,
  })
}

export async function getSetupAwareCommandCenter({ config, is_initialized, provider_status_rows, store, env }: SetupAwareCommandCenterInput): Promise<AppCommandCenter> {
  // EXPLICIT unconfigured branch (two-state mode model). An unconfigured app has made no mode choice and
  // has no ledger — it must steer to setup, never claim an initialized ledger. Checked FIRST so it can
  // never fall through into the personal-local rendering path.
  if (isUnconfiguredForUser(config, env)) {
    return {
      product_name: 'Owner’s Manual',
      setup_status: 'Set up your workflow to begin',
      provider_status: 'Provider: not selected yet',
      strategy_status: 'Strategy: Buffett 4-Pillar default',
      shariah_status: config.shariah.enabled ? 'Shariah: enabled by default' : 'Shariah: disabled',
      ledger_status: 'Ledger: not set up yet',
      pipeline_counts: {
        research_cases: 0,
        watchlist_drafts: 0,
        confirmed_watchlist_items: 0,
        open_holdings: 0,
        pending_user_actions: 0,
      },
      next_recommended_action: 'Connect a provider to set up your personal-local workflow',
      approval_queue: [],
      recent_activity: [{ event_id: 'placeholder:not-set-up-yet', label: 'Not set up yet' }],
      monitor_alerts: [],
      discovery_signals: [],
      duties_due: [],
      primary_action: { href: '/settings/providers', label: 'Continue setup' },
      secondary_action: { href: '/settings/providers', label: 'Review provider readiness' },
    }
  }

  if (!is_initialized || config.ledger_path === undefined) {
    return {
      product_name: 'Owner’s Manual',
      setup_status: 'Setup required',
      provider_status: `Provider: ${humanizeProvider(config.provider.provider_id)} not ready yet`,
      strategy_status: 'Strategy: Buffett 4-Pillar default',
      shariah_status: config.shariah.enabled ? 'Shariah: enabled by default' : 'Shariah: disabled',
      ledger_status: 'Ledger: not initialized yet',
      pipeline_counts: {
        research_cases: 0,
        watchlist_drafts: 0,
        confirmed_watchlist_items: 0,
        open_holdings: 0,
        pending_user_actions: 0,
      },
      next_recommended_action: 'Complete onboarding and initialize the personal local ledger',
      approval_queue: [],
      recent_activity: [{ event_id: 'placeholder:no-durable-ledger-events-yet', label: 'No durable ledger events yet' }],
      monitor_alerts: [],
      discovery_signals: [],
      duties_due: [],
      primary_action: { href: '/settings/providers', label: 'Continue setup' },
    }
  }

  const providerStatus = await buildCommandCenterProviderStatus(config, provider_status_rows)
  let ownedStore: SQLiteEventStore | undefined
  try {
    const activeStore = store ?? (ownedStore = new SQLiteEventStore(config.ledger_path))
    const events = await activeStore.list()
    const summary = projectCommandCenterSummary(events)
    // SCALE-DOWN S2: the accounting books are removed — no accounting alert.

    return {
      product_name: 'Owner’s Manual',
      setup_status: 'Personal local mode initialized',
      provider_status: providerStatus,
      strategy_status: 'Strategy: Buffett 4-Pillar default',
      shariah_status: config.shariah.enabled ? 'Shariah: enabled by default' : 'Shariah: disabled',
      ledger_status: 'Ledger: SQLite durable event source',
      pipeline_counts: summary.pipeline_counts,
      next_recommended_action: summary.pipeline_counts.research_cases === 0
        ? 'Open the selected-strategy research cockpit'
        : summary.next_recommended_action,
      approval_queue: summary.approval_queue,
      recent_activity: summary.recent_activity.length === 0
        ? [{ event_id: 'placeholder:no-ledger-events-yet', label: 'No ledger events yet' }]
        : summary.recent_activity,
      monitor_alerts: projectMonitorAlerts(events),
      discovery_signals: buildDiscoverySignals(events),
      duties_due: buildDutiesDue(events, config),
      primary_action: summary.approval_queue[0] !== undefined
        ? { href: summary.approval_queue[0].href, label: 'Review the highest-priority decision' }
        : summary.pipeline_counts.research_cases === 0
          ? { href: '/research', label: 'Open research cockpit' }
          : summary.pipeline_counts.open_holdings > 0
            ? { href: '/portfolio', label: 'Open portfolio' }
            : { href: `/research/${summary.primary_research_case_id ?? ''}`, label: 'Open latest research case' },
      secondary_action: { href: '/watchlist', label: 'Open watchlist drafts' },
    }
  } finally {
    ownedStore?.close()
  }
}


async function buildCommandCenterProviderStatus(
  config: AppConfig,
  injectedRows: ProviderStatusRow[] | undefined,
): Promise<string> {
  const providerLabel = humanizeProvider(config.provider.provider_id)
  const rows = injectedRows ?? await buildProviderStatusRows()
  const row = rows.find((candidate) => candidate.provider_id === config.provider.provider_id)

  if (row === undefined) {
    return `Provider: ${providerLabel} readiness unknown`
  }

  const supportLabel = supportLevelLabel(row.effective_support_level)
  if (row.is_ready && row.readiness_state === 'supported') {
    return `Provider: ${providerLabel} ${supportLabel}`
  }

  return `Provider: ${providerLabel} ${supportLabel} — ${row.status_label}`
}

function supportLevelLabel(supportLevel: ProviderStatusRow['effective_support_level']): string {
  switch (supportLevel) {
    case 'certified':
      return 'certified'
    case 'experimental':
      return 'experimental'
    case 'unsupported':
      return 'unsupported'
  }
}

function humanizeProvider(providerId: AppConfig['provider']['provider_id']): string {
  switch (providerId) {
    case 'mock-provider':
      return 'Mock provider'
    case 'openrouter':
      return 'OpenRouter'
    case 'local':
      return 'Local (Ollama / vLLM)'
  }
}
