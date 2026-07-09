// Restructure Phase 1 / S1 — the FRONT Shariah gate.
//
// Runs BEFORE any deep-dive lane spend: the grounded sector judgment (runShariahReasoningPass moved
// forward — pre-lane there is no laneDigest, so it is seeded with the pre-verified filing corpus the
// swarm front already grounds) plus the deterministic AAOIFI ratio verdict when ratio inputs (market
// cap + fundamentals) are available this early.
//
// Gate policy (mirrors the retired quick screen's posture, hardened):
//   - sector non_compliant  → CLOSED (the caller emits the existing set-aside dossier)
//   - AAOIFI ratio FAIL     → CLOSED (deterministic arithmetic — code computes)
//   - compliant/conditional → OPEN (conditional carries through; synthesis reconciles later)
//   - pass FAILED / ratios not computable → OPEN but VISIBLY undetermined (gate_incomplete: true) —
//     the gate must never fabricate compliance NOR block on its own outage; the post-lane Shariah
//     machinery still fails closed to UNDETERMINED downstream.

import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { computeShariahFinancialRatios, type ShariahFinancialRatioInputs } from '@owlfolio/strategies/shariahFinancialRatios'

import type { runShariahReasoningPass } from './shariahReasoningPass'

export type ShariahGateSectorStatus = 'compliant' | 'conditional' | 'non_compliant' | 'undetermined'

export type ShariahGateCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  model_id: string
  /** The event this gate is caused by (research_case_created / research_run_claimed). */
  causation_event_id: string
}

type ReasoningPassOutcome = Awaited<ReturnType<typeof runShariahReasoningPass>>

export type ShariahGatePhaseDeps = {
  /** The reasoning-pass invocation, pre-bound by the swarm front (provider/corpus/grounding threaded there). */
  reasoningPass: () => Promise<ReasoningPassOutcome>
  /** The corpus ids the pass was seeded with (recorded on the event for audit). */
  corpusSourceIds: string[]
  /**
   * Deterministic AAOIFI ratio inputs when computable this early (fundamentals + market cap).
   * Absent → ratios undetermined at the gate; the synthesis-time recompute still runs downstream.
   */
  ratioInputs?: Omit<ShariahFinancialRatioInputs, 'impermissible_income'>
  now?: () => string
}

export type ShariahGatePhaseResult = {
  allowed: boolean
  reason: string
  event_id: string
  judgment?: { sector_status: ShariahGateSectorStatus; impermissible_income: number | null }
}

export async function runShariahGatePhase(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  command: ShariahGateCommand,
  deps: ShariahGatePhaseDeps,
): Promise<ShariahGatePhaseResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  const startedAt = Date.now()

  const outcome = await deps.reasoningPass()
  const passOk = outcome.status === 'ok'
  const sectorStatus: ShariahGateSectorStatus = passOk ? outcome.shariah_judgment.sector_status : 'undetermined'
  const impermissibleIncome = passOk ? outcome.shariah_judgment.impermissible_income : null

  // Deterministic AAOIFI verdict when the inputs exist this early (code computes; the model only
  // supplied impermissible_income — null flows through as undetermined inside the ratio math).
  const ratioResult = deps.ratioInputs === undefined
    ? undefined
    : computeShariahFinancialRatios({ ...deps.ratioInputs, impermissible_income: impermissibleIncome ?? null })
  const ratioVerdict = ratioResult !== undefined && ratioResult.computable ? ratioResult.verdict : undefined

  let allowed = true
  let reason = 'shariah_gate_open: no hard stop — the deep dive may spend.'
  if (sectorStatus === 'non_compliant') {
    allowed = false
    reason = 'shariah_gate_closed: the grounded sector judgment is NON-COMPLIANT — a hard stop before any lane spend.'
  } else if (ratioVerdict === 'FAIL') {
    allowed = false
    reason = 'shariah_gate_closed: the deterministic AAOIFI financial ratios FAIL — a hard stop before any lane spend.'
  } else if (!passOk) {
    reason = 'shariah_gate_open: the sector judgment could not be grounded (gate_incomplete) — proceeding; the downstream Shariah machinery still fails closed to UNDETERMINED.'
  }

  const gateId = `shariah_gate_${command.research_case_id}`
  const event: LedgerEventEnvelope<Record<string, unknown>> = {
    event_id: `evt_shariah_gate_judged_${command.research_case_id}`,
    event_type: 'shariah_gate_judged',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    causation_id: command.causation_event_id,
    correlation_id: command.research_case_id,
    actor_type: 'provider',
    actor_id: command.model_id,
    payload: {
      shariah_gate_id: gateId,
      research_case_id: command.research_case_id,
      company_id: command.company_id,
      ticker: command.ticker,
      allowed,
      sector_status: sectorStatus,
      impermissible_income: impermissibleIncome,
      ...(ratioVerdict === undefined ? {} : { ratio_verdict: ratioVerdict }),
      ...(passOk ? {} : { gate_incomplete: true }),
      reason,
      corpus_source_ids: deps.corpusSourceIds,
      stage_cost: { provider_calls: 1, wall_ms: Date.now() - startedAt },
    },
    source_ids: passOk && typeof outcome.shariah_judgment.sector_citation === 'string' ? [outcome.shariah_judgment.sector_citation] : [],
    created_at: now(),
    schema_version: 1,
    idempotency_key: `shariah-gate:${command.research_case_id}:v1`,
  }
  await store.append(event as LedgerEventEnvelope<unknown>)

  return {
    allowed,
    reason,
    event_id: event.event_id,
    ...(passOk ? { judgment: { sector_status: sectorStatus, impermissible_income: impermissibleIncome } } : {}),
  }
}
