import type { LedgerEventEnvelope } from '../eventEnvelope'

export type PendingResearchRun = {
  research_case_id: string
  ticker: string
  company_id?: string
  strategy_id?: string
  model_id?: string
  decision_id?: string
  /**
   * The provider the run was REQUESTED under (from the web app's loaded config). Defense-in-depth:
   * the worker fails closed if this differs from the provider it actually loaded. Absent on legacy
   * requests, in which case the worker does NOT fail on it (backward-compat).
   */
  expected_provider_id?: string
  /** The mode the run was REQUESTED under (e.g. `personal-local`). Absent on legacy requests. */
  expected_mode?: string
  /**
   * The prior research case this run SUPERSEDES (set by an explicit "Re-run on current engine" action,
   * or by auto-versioning). The worker threads this into the new case's `research_case_created` so the
   * superseded case is hidden from active views. Absent → a plain new run (no supersession).
   */
  supersedes_research_case_id?: string
  /**
   * The lineage version the new case should be created at (1 for a first run, prior+1 for a re-run /
   * auto-version). The worker threads this into `research_case_created` so a re-run dossier shows the
   * correct `vN` lineage. Absent on legacy requests → the worker defaults to v1 (backward-compat).
   */
  version?: number
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
  /** Sources verified at the admitting front gate (legacy pending events: the quick screen). */
  gate_source_ids: string[]
  /** The admitting gate event (shariah_gate_judged; legacy pending events: quick_screen_drafted). */
  gate_event_id: string
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
      ...(p.expected_provider_id === undefined ? {} : { expected_provider_id: String(p.expected_provider_id) }),
      ...(p.expected_mode === undefined ? {} : { expected_mode: String(p.expected_mode) }),
      ...(p.supersedes_research_case_id === undefined ? {} : { supersedes_research_case_id: String(p.supersedes_research_case_id) }),
      ...(p.version === undefined ? {} : { version: Number(p.version) }),
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

    // S2 rename with legacy tolerance: current pending events carry gate_source_ids/gate_event_id
    // (the front Shariah gate); events persisted before the quick-screen retirement carry
    // quick_screen_source_ids/quick_screen_event_id. Both resume correctly.
    const rawSourceIds = approvalPayload?.['gate_source_ids'] ?? approvalPayload?.['quick_screen_source_ids']
    const gate_source_ids = Array.isArray(rawSourceIds) ? (rawSourceIds as unknown[]).map(String) : []
    const gate_event_id = String(approvalPayload?.['gate_event_id'] ?? approvalPayload?.['quick_screen_event_id'] ?? '')

    pending.push({
      research_case_id: id,
      ticker: String(p.ticker ?? approvalPayload?.['ticker'] ?? ''),
      ...(approvalPayload?.['company_id'] !== undefined ? { company_id: String(approvalPayload['company_id']) } : {}),
      ...(approvalPayload?.['strategy_id'] !== undefined ? { strategy_id: String(approvalPayload['strategy_id']) } : {}),
      ...(approvalPayload?.['model_id'] !== undefined ? { model_id: String(approvalPayload['model_id']) } : {}),
      ...(approvalPayload?.['decision_id'] !== undefined ? { decision_id: String(approvalPayload['decision_id']) } : {}),
      ...(approvalPayload?.['source_ledger_path'] !== undefined ? { source_ledger_path: String(approvalPayload['source_ledger_path']) } : {}),
      gate_source_ids,
      gate_event_id,
      requested_event_id: e.event_id,
    })
  }
  return pending
}
