import type { ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import {
  projectResearchCaseTimeline,
  type ResearchCaseTimelineEntry,
} from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
import type { WatchlistProjection } from '@owlfolio/ledger/projections/watchlistProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { resolveProvider } from '@owlfolio/providers'
import type { AppConfig } from '@owlfolio/shared'
import { runClaudeBuffettMungerResearch } from '@owlfolio/workflow'

import type { StatusBadgeTone } from '../components/StatusBadge'
import { getDemoResearchCaseFromStore, getDemoWatchlistItemsFromStore } from './demo'
import type { OnboardingState } from './onboarding'

export type WorkflowMode = AppConfig['mode']

export type AppGateChecklistItem = {
  label: string
  status: string
  tone: StatusBadgeTone
}

export type AppResearchCase = ResearchCaseProjection & {
  gate_checklist: AppGateChecklistItem[]
  source_ids: string[]
  ledger_timeline: ResearchCaseTimelineEntry[]
}

export type AppWatchlistItem = WatchlistProjection & {
  buy_zone_status?: string
}

const pendingChecklist: AppGateChecklistItem[] = [
  { label: 'Quality business', status: 'Pending', tone: 'neutral' },
  { label: 'Management alignment', status: 'Pending', tone: 'neutral' },
  { label: 'Margin of safety', status: 'Pending', tone: 'neutral' },
]

export function resolveActiveWorkflowMode(config: Pick<AppConfig, 'mode'>): WorkflowMode {
  return config.mode
}

export async function createPersonalResearchCase(
  state: OnboardingState,
  input: { ticker: string; company_id?: string },
) {
  if (
    !state.is_initialized
    || state.config.mode !== 'personal-local'
    || state.config.ledger_path === undefined
    || state.config.source_ledger_path === undefined
  ) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const ticker = input.ticker.trim().toUpperCase()
  if (ticker.length === 0) {
    throw new Error('Ticker is required')
  }

  const companyId = input.company_id?.trim() || `company_${ticker.toLowerCase()}`
  const researchCaseId = `rc_${ticker.toLowerCase()}_${Date.now()}`
  const decisionId = `decision_${ticker.toLowerCase()}_${Date.now()}`
  const provider = resolveProvider({ provider_id: state.config.provider.provider_id })

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const result = await runClaudeBuffettMungerResearch(store, provider, {
      research_case_id: researchCaseId,
      company_id: companyId,
      ticker,
      strategy_id: state.config.strategy_id,
      actor_id: 'user_local',
      idempotency_key: `personal:create:${ticker}:${researchCaseId}`,
      model_id: resolveModelId(state.config),
      source_ledger_path: state.config.source_ledger_path,
      analysis_idempotency_key: `analysis:${researchCaseId}:${provider.provider_id}:v1`,
      decision_id: decisionId,
      decision_idempotency_key: `decision:${researchCaseId}:${decisionId}:v1`,
    })

    return result.research_case
  } finally {
    store.close()
  }
}

export async function getAppResearchCaseFromStore(
  store: EventStore,
  mode: WorkflowMode,
  caseId: string,
): Promise<AppResearchCase> {
  if (mode === 'demo') {
    return getDemoResearchCaseFromStore(store, caseId)
  }

  const events = await store.list()
  const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === caseId)
  if (researchCase === undefined) {
    throw new Error(`Unknown research case: ${caseId}`)
  }

  return buildPersonalResearchCase(events, researchCase)
}

export async function getAppWatchlistItemsFromStore(
  store: EventStore,
  mode: WorkflowMode,
): Promise<AppWatchlistItem[]> {
  if (mode === 'demo') {
    return getDemoWatchlistItemsFromStore(store)
  }

  return projectWatchlist(await store.list()).map((item) => ({ ...item }))
}

function buildPersonalResearchCase(
  events: Awaited<ReturnType<EventStore['list']>>,
  researchCase: ResearchCaseProjection,
): AppResearchCase {
  const timeline = projectResearchCaseTimeline(events, researchCase.research_case_id)

  return {
    ...researchCase,
    gate_checklist: pendingChecklist.map((gate) => ({ ...gate })),
    source_ids: [...new Set(timeline.flatMap((entry) => entry.source_ids))],
    ledger_timeline: timeline,
    next_required_action: researchCase.next_required_action ?? `Start Buffett-Munger research for ${researchCase.ticker ?? researchCase.research_case_id}`,
  }
}

function resolveModelId(config: Pick<AppConfig, 'provider'>): string {
  if (config.provider.model_id !== undefined && config.provider.model_id.length > 0) {
    return config.provider.model_id
  }

  if (config.provider.provider_id === 'mock-provider') {
    return 'mock-buffett-munger-demo'
  }

  if (config.provider.provider_id === 'claude') {
    return 'claude-sonnet-4-6'
  }

  return 'gpt-4.1'
}
