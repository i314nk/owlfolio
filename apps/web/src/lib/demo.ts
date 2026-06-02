import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

import { projectCommandCenterSummary, type CommandCenterHoldingReviewPrompt, type CommandCenterRecentActivity } from '@owlfolio/ledger/projections/commandCenterProjection'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { projectResearchCases, type ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'
import {
  projectResearchCaseTimeline,
  type ResearchCaseTimelineEntry,
} from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
import { projectWatchlist, type WatchlistProjection } from '@owlfolio/ledger/projections/watchlistProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { AppConfig } from '@owlfolio/shared'

import type { StatusBadgeTone } from '../components/StatusBadge'
import { buildMonthlyAccountingReport } from './accounting'
import { DEMO_RESEARCH_CASE_ID, seedDemoLedger } from './demoSeed'

export { seedDemoLedger } from './demoSeed'

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

export type CommandCenterAccountingAlert = {
  label: string
  message: string
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
  holding_review_prompts: CommandCenterHoldingReviewPrompt[]
  accounting_alert?: CommandCenterAccountingAlert
  recent_activity: CommandCenterRecentActivity[]
  primary_action: CommandCenterAction
  secondary_action?: CommandCenterAction
}

export type DemoCommandCenter = AppCommandCenter

export type DemoGateChecklistItem = {
  label: string
  status: string
  tone: StatusBadgeTone
}

export type DemoResearchCase = ResearchCaseProjection & {
  gate_checklist: DemoGateChecklistItem[]
  source_ids: string[]
  ledger_timeline: ResearchCaseTimelineEntry[]
}

export type DemoWatchlistItem = WatchlistProjection & {
  buy_zone_status?: string
}

const demoGateChecklist: DemoGateChecklistItem[] = [
  { label: 'Quality business', status: 'Pass', tone: 'success' },
  { label: 'Management alignment', status: 'Review', tone: 'neutral' },
  { label: 'Margin of safety', status: 'Watch', tone: 'warning' },
]

let defaultDemoStore: SQLiteEventStore | undefined

type DemoLedgerEnv = {
  OWLFOLIO_DEMO_LEDGER_PATH?: string
  OWLFOLIO_PROJECT_DIR?: string
}

type ResolveDemoLedgerPathOptions = {
  cwd?: string
  env?: DemoLedgerEnv
}

export type SetupAwareCommandCenterInput = {
  config: AppConfig
  is_initialized: boolean
  store?: EventStore
}

export function resolveDemoLedgerPath({ cwd = process.cwd(), env = process.env as DemoLedgerEnv }: ResolveDemoLedgerPathOptions = {}): string {
  if (env.OWLFOLIO_DEMO_LEDGER_PATH !== undefined && env.OWLFOLIO_DEMO_LEDGER_PATH.length > 0) {
    return env.OWLFOLIO_DEMO_LEDGER_PATH
  }

  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? findWorkspaceRoot(cwd) ?? cwd
  return join(projectRoot, 'data', 'demo-ledger.sqlite')
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = start
  const { root } = parse(start)

  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    if (current === root) {
      return undefined
    }

    current = dirname(current)
  }
}

export async function resetDefaultDemoStore(): Promise<void> {
  defaultDemoStore?.close()
  defaultDemoStore = undefined
}

async function getDefaultDemoStore(): Promise<EventStore> {
  defaultDemoStore ??= new SQLiteEventStore(resolveDemoLedgerPath())
  await seedDemoLedger(defaultDemoStore)
  return defaultDemoStore
}

export async function getDemoEvents(): Promise<LedgerEventEnvelope<unknown>[]> {
  const store = await getDefaultDemoStore()
  return store.list()
}

export async function getDemoEventsFromStore(store: EventStore): Promise<LedgerEventEnvelope<unknown>[]> {
  return store.list()
}

export async function getDemoCommandCenter(): Promise<DemoCommandCenter> {
  return getDemoCommandCenterFromStore(await getDefaultDemoStore())
}

export async function getDemoCommandCenterFromStore(store: EventStore): Promise<DemoCommandCenter> {
  const events = await getDemoEventsFromStore(store)
  const summary = projectCommandCenterSummary(events)

  return buildDemoCommandCenter(summary, events)
}

export async function getSetupAwareCommandCenter({ config, is_initialized, store }: SetupAwareCommandCenterInput): Promise<AppCommandCenter> {
  if (config.mode === 'demo') {
    return store === undefined ? getDemoCommandCenter() : getDemoCommandCenterFromStore(store)
  }

  if (!is_initialized || config.ledger_path === undefined) {
    return {
      product_name: 'Owlfolio',
      setup_status: 'Setup required',
      provider_status: `Provider: ${humanizeProvider(config.provider.provider_id)} not ready yet`,
      strategy_status: 'Strategy: Buffett-Munger certified',
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
      holding_review_prompts: [],
      recent_activity: [{ event_id: 'placeholder:no-durable-ledger-events-yet', label: 'No durable ledger events yet' }],
      primary_action: { href: '/onboarding', label: 'Continue setup' },
    }
  }

  let ownedStore: SQLiteEventStore | undefined
  try {
    const activeStore = store ?? (ownedStore = new SQLiteEventStore(config.ledger_path))
    const events = await activeStore.list()
    const summary = projectCommandCenterSummary(events)
    const accountingAlert = buildAccountingAlert(events)

    return {
      product_name: 'Owlfolio',
      setup_status: 'Personal local mode initialized',
      provider_status: `Provider: ${humanizeProvider(config.provider.provider_id)} personal local mode`,
      strategy_status: 'Strategy: Buffett-Munger certified',
      shariah_status: config.shariah.enabled ? 'Shariah: enabled by default' : 'Shariah: disabled',
      ledger_status: 'Ledger: SQLite durable event source',
      pipeline_counts: summary.pipeline_counts,
      next_recommended_action: summary.pipeline_counts.research_cases === 0
        ? 'Create or import your first research case'
        : summary.next_recommended_action,
      holding_review_prompts: summary.holding_review_prompts,
      ...(accountingAlert === undefined ? {} : { accounting_alert: accountingAlert }),
      recent_activity: summary.recent_activity.length === 0
        ? [{ event_id: 'placeholder:no-ledger-events-yet', label: 'No ledger events yet' }]
        : summary.recent_activity,
      primary_action: summary.pipeline_counts.research_cases === 0
        ? { href: '/research/new', label: 'Start first research case' }
        : summary.pipeline_counts.open_holdings > 0
          ? { href: '/portfolio', label: 'Open portfolio' }
          : { href: `/research/${summary.primary_research_case_id ?? ''}`, label: 'Open latest research case' },
      secondary_action: { href: '/watchlist', label: 'Open watchlist drafts' },
    }
  } finally {
    ownedStore?.close()
  }
}

function buildDemoCommandCenter(
  summary: ReturnType<typeof projectCommandCenterSummary>,
  events: LedgerEventEnvelope<unknown>[],
): DemoCommandCenter {
  const accountingAlert = buildAccountingAlert(events)

  return {
    product_name: 'Owlfolio',
    setup_status: 'Setup ready',
    provider_status: 'Provider: Mock provider / demo mode',
    strategy_status: 'Strategy: Buffett-Munger certified',
    shariah_status: 'Shariah: enabled by default',
    ledger_status: 'Ledger: SQLite durable event source',
    pipeline_counts: summary.pipeline_counts,
    next_recommended_action: summary.next_recommended_action,
    holding_review_prompts: summary.holding_review_prompts,
    ...(accountingAlert === undefined ? {} : { accounting_alert: accountingAlert }),
    recent_activity: summary.recent_activity,
    primary_action: {
      href: `/research/${summary.primary_research_case_id ?? DEMO_RESEARCH_CASE_ID}`,
      label: 'View demo research case',
    },
    secondary_action: {
      href: '/watchlist',
      label: 'Open watchlist drafts',
    },
  }
}

function buildAccountingAlert(events: LedgerEventEnvelope<unknown>[]): CommandCenterAccountingAlert | undefined {
  const hasAccountingSource = events.some((event) => event.event_type === 'holding_opened' || event.event_type === 'accounting_snapshot_recorded')
  if (!hasAccountingSource) {
    return undefined
  }

  const report = buildMonthlyAccountingReport(events)
  const snapshot = report.current_period_snapshot
  return {
    label: 'Monthly accounting report',
    message: `${formatAccountingMonth(snapshot.period_end)} NAV: ${formatAccountingMoney(snapshot.nav, snapshot.currency)}; ${snapshot.missing_valuation_holding_ids.length} holdings missing valuations.`,
    href: '/accounting/monthly',
  }
}

function formatAccountingMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { currency, style: 'currency' }).format(value)
}

function formatAccountingMonth(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC', year: 'numeric' }).format(new Date(`${date}T00:00:00.000Z`))
}

function humanizeProvider(providerId: AppConfig['provider']['provider_id']): string {
  switch (providerId) {
    case 'claude':
      return 'Claude'
    case 'openai':
      return 'OpenAI'
    case 'mock-provider':
      return 'Mock provider'
  }
}

export async function getDemoResearchCases(): Promise<DemoResearchCase[]> {
  return getDemoResearchCasesFromStore(await getDefaultDemoStore())
}

export async function getDemoResearchCasesFromStore(store: EventStore): Promise<DemoResearchCase[]> {
  return projectDemoResearchCases(await getDemoEventsFromStore(store))
}

export async function getDemoResearchCase(caseId: string): Promise<DemoResearchCase> {
  return getDemoResearchCaseFromStore(await getDefaultDemoStore(), caseId)
}

export async function getDemoResearchCaseFromStore(store: EventStore, caseId: string): Promise<DemoResearchCase> {
  const researchCase = (await getDemoResearchCasesFromStore(store)).find((candidate) => candidate.research_case_id === caseId)

  if (researchCase === undefined) {
    throw new Error(`Unknown demo research case: ${caseId}`)
  }

  return researchCase
}

export async function getDemoWatchlistItems(): Promise<DemoWatchlistItem[]> {
  return getDemoWatchlistItemsFromStore(await getDefaultDemoStore())
}

export async function getDemoWatchlistItemsFromStore(store: EventStore): Promise<DemoWatchlistItem[]> {
  return projectWatchlist(await getDemoEventsFromStore(store)).map((item) => ({ ...item }))
}

function projectDemoResearchCases(events: LedgerEventEnvelope<unknown>[]): DemoResearchCase[] {
  return projectResearchCases(events).map((researchCase) => {
    const timeline = projectResearchCaseTimeline(events, researchCase.research_case_id)

    return {
      ...researchCase,
      gate_checklist: demoGateChecklist.map((gate) => ({ ...gate })),
      source_ids: [...new Set(timeline.flatMap((entry) => entry.source_ids))],
      ledger_timeline: timeline,
    }
  })
}
