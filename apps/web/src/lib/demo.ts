import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

import { projectCommandCenterSummary } from '@owlfolio/ledger/projections/commandCenterProjection'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { projectResearchCases, type ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'
import {
  projectResearchCaseTimeline,
  type ResearchCaseTimelineEntry,
} from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
import { projectWatchlist, type WatchlistProjection } from '@owlfolio/ledger/projections/watchlistProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import type { StatusBadgeTone } from '../components/StatusBadge'
import { DEMO_RESEARCH_CASE_ID, seedDemoLedger } from './demoSeed'

export { seedDemoLedger } from './demoSeed'

export type PipelineCounts = {
  research_cases: number
  watchlist_drafts: number
  pending_user_actions: number
}

export type DemoCommandCenter = {
  product_name: string
  setup_status: string
  provider_status: string
  strategy_status: string
  shariah_status: string
  ledger_status: string
  pipeline_counts: PipelineCounts
  next_recommended_action: string
  demo_research_case_id: string
  recent_activity: string[]
}

export type DemoGateChecklistItem = {
  label: string
  status: string
  tone: StatusBadgeTone
}

export type ResearchCaseTimelineEntry = {
  event_id: string
  event_type: string
  actor_type: LedgerEventEnvelope<unknown>['actor_type']
  actor_id?: string
  actor_label: string
  created_at: string
  summary: string
  source_ids: string[]
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

  return {
    product_name: 'Owlfolio',
    setup_status: 'Setup ready',
    provider_status: 'Provider: Mock provider / demo mode',
    strategy_status: 'Strategy: Buffett-Munger certified',
    shariah_status: 'Shariah: enabled by default',
    ledger_status: 'Ledger: SQLite durable event source',
    pipeline_counts: summary.pipeline_counts,
    next_recommended_action: summary.next_recommended_action,
    demo_research_case_id: summary.primary_research_case_id ?? DEMO_RESEARCH_CASE_ID,
    recent_activity: summary.recent_activity,
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

