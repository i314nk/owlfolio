import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { Provider, ProviderRunRequest } from '@owlfolio/providers'
import { z } from 'zod'

import {
  createResearchCase,
  draftDecision,
  type BuffettMungerAnalysisDrafted,
  type CreateResearchCaseCommand,
  type DecisionDrafted,
  type InvestmentVerdict,
  type ShariahStatus,
  type StrategyCompliance,
  type ValuationStatus,
} from './researchWorkflow'
import { writeSourceLedgerBundle, type SourceLedgerBundle } from './sourceLedger'

const ClaudeBuffettMungerResearchSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  decision_reason: z.string().min(1),
  source_records: z.array(
    z.object({
      source_id: z.string().min(1),
      title: z.string().min(1),
      url: z.string().url(),
      excerpt: z.string().min(1),
      citation_locator: z.string().optional(),
      content_hash: z.string().optional(),
    }),
  ).min(1),
})

type ResearchEventStore = EventStore<LedgerEventEnvelope<unknown>>

type ClaudeAnalysisPayload = {
  research_case_id: string
  company_id: string
  ticker: string
  investment_verdict: InvestmentVerdict
  strategy_compliance: StrategyCompliance
  shariah_status: Exclude<ShariahStatus, 'UNKNOWN'>
  valuation_status: ValuationStatus
  next_required_action: string
}

export type RunClaudeBuffettMungerResearchCommand = CreateResearchCaseCommand & {
  model_id: string
  source_ledger_path: string
  analysis_idempotency_key: string
  decision_id: string
  decision_idempotency_key?: string
}

export type ClaudeResearchWorkflowResult = {
  research_case: Awaited<ReturnType<typeof createResearchCase>>
  analysis: BuffettMungerAnalysisDrafted
  decision: DecisionDrafted
  source_bundle: SourceLedgerBundle
}

function nowIso(): string {
  return new Date().toISOString()
}

function eventId(prefix: string, id: string): string {
  return `${prefix}_${id}`
}

function mergeEventPayload<TPayload extends object>(
  event: LedgerEventEnvelope<TPayload>,
): LedgerEventEnvelope<TPayload> & TPayload {
  return { ...event, ...event.payload }
}

function buildRequest(command: RunClaudeBuffettMungerResearchCommand, provider: Provider): ProviderRunRequest {
  return {
    run_id: `run_${command.research_case_id}_claude_research`,
    provider_id: provider.provider_id,
    model_id: command.model_id,
    task_kind: 'structured-output',
    prompt: [
      `You are the Buffett-Munger research specialist for Owlfolio research case ${command.research_case_id}.`,
      `Analyze ticker ${command.ticker} (${command.company_id}) under the certified Buffett-Munger policy.`,
      'Return only the structured fields requested by the JSON schema.',
      'Use source_records for the concrete primary/secondary sources that support the draft.',
    ].join(' '),
    timeout_ms: 120_000,
    budget: { max_tool_calls: 0, max_tokens: 8_000 },
    tool_allowlist: [],
    response_format: { kind: 'json-schema', schema_name: 'ClaudeBuffettMungerResearch' },
  }
}

async function appendAnalysisDraft(
  store: ResearchEventStore,
  provider: Provider,
  command: RunClaudeBuffettMungerResearchCommand,
  payload: ClaudeAnalysisPayload,
  sourceIds: string[],
): Promise<BuffettMungerAnalysisDrafted> {
  const event: LedgerEventEnvelope<ClaudeAnalysisPayload> = {
    event_id: eventId('evt_buffett_munger_analysis_drafted', command.research_case_id),
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    idempotency_key: command.analysis_idempotency_key,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload,
    source_ids: sourceIds,
    created_at: nowIso(),
    schema_version: 1,
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<ClaudeAnalysisPayload>)
}

export async function runClaudeBuffettMungerResearch(
  store: ResearchEventStore,
  provider: Provider,
  command: RunClaudeBuffettMungerResearchCommand,
): Promise<ClaudeResearchWorkflowResult> {
  const researchCase = await createResearchCase(store, command)
  const structured = await provider.structured(buildRequest(command, provider), ClaudeBuffettMungerResearchSchema)

  const sourceBundle = await writeSourceLedgerBundle({
    source_ledger_path: command.source_ledger_path,
    research_case_id: command.research_case_id,
    provider_id: provider.provider_id,
    records: structured.source_records.map((record) => ({
      source_id: record.source_id,
      title: record.title,
      url: record.url,
      excerpt: record.excerpt,
      ...(record.citation_locator === undefined ? {} : { citation_locator: record.citation_locator }),
      ...(record.content_hash === undefined ? {} : { content_hash: record.content_hash }),
      metadata: {
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        strategy_id: command.strategy_id,
      },
    })),
  })

  const analysis = await appendAnalysisDraft(
    store,
    provider,
    command,
    {
      research_case_id: command.research_case_id,
      company_id: command.company_id,
      ticker: command.ticker,
      investment_verdict: structured.investment_verdict,
      strategy_compliance: structured.strategy_compliance,
      shariah_status: structured.shariah_status,
      valuation_status: structured.valuation_status,
      next_required_action: structured.next_required_action,
    },
    sourceBundle.records.map((record) => record.source_id),
  )

  const decision = await draftDecision(store, {
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    decision: structured.investment_verdict,
    reason: structured.decision_reason,
    causation_id: analysis.event_id,
    source_ids: sourceBundle.records.map((record) => record.source_id),
    ...(command.decision_idempotency_key === undefined
      ? {}
      : { idempotency_key: command.decision_idempotency_key }),
  })

  return {
    research_case: researchCase,
    analysis,
    decision,
    source_bundle: sourceBundle,
  }
}
