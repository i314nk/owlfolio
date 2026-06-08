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
