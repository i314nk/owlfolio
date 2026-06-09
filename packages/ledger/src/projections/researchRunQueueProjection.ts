import type { LedgerEventEnvelope } from '../eventEnvelope'

export type PendingResearchRun = {
  research_case_id: string
  ticker: string
  company_id?: string
  strategy_id?: string
  model_id?: string
  decision_id?: string
  requested_event_id: string
}

export type PendingDeepDiveRun = {
  research_case_id: string
  ticker: string
  company_id?: string
  strategy_id?: string
  model_id?: string
  decision_id?: string
  source_ledger_path?: string
  quick_screen_source_ids: string[]
  quick_screen_event_id: string
  requested_event_id: string
}

export function projectPendingResearchRuns(
  events: LedgerEventEnvelope<Record<string, unknown>>[],
): PendingResearchRun[] {
  const claimed = new Set<string>()
  for (const e of events) {
    if (e.event_type === 'research_run_claimed') {
      claimed.add(String((e.payload as Record<string, unknown>).research_case_id ?? e.aggregate_id))
    }
  }
  const pending: PendingResearchRun[] = []
  for (const e of events) {
    if (e.event_type !== 'research_run_requested') continue
    const p = e.payload as Record<string, unknown>
    const id = String(p.research_case_id ?? e.aggregate_id)
    if (claimed.has(id)) continue
    pending.push({
      research_case_id: id,
      ticker: String(p.ticker ?? ''),
      ...(p.company_id === undefined ? {} : { company_id: String(p.company_id) }),
      ...(p.strategy_id === undefined ? {} : { strategy_id: String(p.strategy_id) }),
      ...(p.model_id === undefined ? {} : { model_id: String(p.model_id) }),
      ...(p.decision_id === undefined ? {} : { decision_id: String(p.decision_id) }),
      requested_event_id: e.event_id,
    })
  }
  return pending
}

/**
 * Projects pending deep-dive runs: cases where `deep_dive_run_requested` has been appended
 * but no `queued_for_deep_dive` (i.e. the deep dive hasn't started yet).
 */
export function projectPendingDeepDiveRuns(
  events: LedgerEventEnvelope<Record<string, unknown>>[],
): PendingDeepDiveRun[] {
  // Cases that already have a deep dive queued/started
  const alreadyQueued = new Set<string>()
  for (const e of events) {
    if (e.event_type === 'queued_for_deep_dive') {
      const p = e.payload as Record<string, unknown>
      alreadyQueued.add(String(p.research_case_id ?? e.aggregate_id))
    }
  }

  // Index deep_dive_approval_pending payloads by research_case_id for quick lookup
  const approvalPendingByCase = new Map<string, Record<string, unknown>>()
  for (const e of events) {
    if (e.event_type === 'deep_dive_approval_pending') {
      const p = e.payload as Record<string, unknown>
      const id = String(p.research_case_id ?? e.aggregate_id)
      approvalPendingByCase.set(id, p)
    }
  }

  const pending: PendingDeepDiveRun[] = []
  for (const e of events) {
    if (e.event_type !== 'deep_dive_run_requested') continue
    const p = e.payload as Record<string, unknown>
    const id = String(p.research_case_id ?? e.aggregate_id)
    if (alreadyQueued.has(id)) continue

    // Get the original deep_dive_approval_pending payload to recover context
    const approvalPayload = approvalPendingByCase.get(id)

    const quick_screen_source_ids = Array.isArray(approvalPayload?.['quick_screen_source_ids'])
      ? (approvalPayload['quick_screen_source_ids'] as unknown[]).map(String)
      : []
    const quick_screen_event_id = String(approvalPayload?.['quick_screen_event_id'] ?? '')

    pending.push({
      research_case_id: id,
      ticker: String(p.ticker ?? approvalPayload?.['ticker'] ?? ''),
      ...(approvalPayload?.['company_id'] !== undefined ? { company_id: String(approvalPayload['company_id']) } : {}),
      ...(approvalPayload?.['strategy_id'] !== undefined ? { strategy_id: String(approvalPayload['strategy_id']) } : {}),
      ...(approvalPayload?.['model_id'] !== undefined ? { model_id: String(approvalPayload['model_id']) } : {}),
      ...(approvalPayload?.['decision_id'] !== undefined ? { decision_id: String(approvalPayload['decision_id']) } : {}),
      ...(approvalPayload?.['source_ledger_path'] !== undefined ? { source_ledger_path: String(approvalPayload['source_ledger_path']) } : {}),
      quick_screen_source_ids,
      quick_screen_event_id,
      requested_event_id: e.event_id,
    })
  }
  return pending
}
