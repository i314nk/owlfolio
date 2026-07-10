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
  /**
   * The EDGAR entity name (when fundamentals resolved) — powers the deterministic entity-mention
   * guard below (live dogfood: a concurrent same-model run returned ANOTHER company's sector
   * narrative; the guard downgrades such a response to gate_incomplete instead of trusting it).
   */
  entity_name?: string
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
  /** The stored gate event (causation anchor + verified sector-citation source_ids for the set-aside). */
  event: LedgerEventEnvelope<unknown>
  judgment?: { sector_status: ShariahGateSectorStatus; impermissible_income: number | null }
  /**
   * The reasoning pass's captured (grounded) sources — the caller folds these into the run corpus so
   * the gate's verified citations stay readable/citable by every later stage (corpus continuity).
   */
  pass_captured?: Extract<ReasoningPassOutcome, { status: 'ok' }>['captured']
}

export async function runShariahGatePhase(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  command: ShariahGateCommand,
  deps: ShariahGatePhaseDeps,
): Promise<ShariahGatePhaseResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  const startedAt = Date.now()

  const outcome = await deps.reasoningPass()
  let passOk = outcome.status === 'ok'
  // ---- Deterministic entity-mention guard (dogfood find, 2026-07-10) ----
  // Three concurrent same-model gate calls produced one response whose narrative described a DIFFERENT
  // company (provider/model-layer contamination — the harness-seeded corpus + citation were verifiably
  // correct). The judgment prompt names the ticker and the filing names the entity, so an honest
  // narrative mentions one of them. When it mentions neither, the response cannot be trusted as a
  // judgment of THIS company: treat the pass as FAILED → the gate opens VISIBLY undetermined
  // (gate_incomplete) and the downstream Shariah machinery still fails closed. Never a silent accept.
  let entityMismatch = false
  if (passOk && outcome.status === 'ok' && command.entity_name !== undefined) {
    const reasoningText = String((outcome.shariah_judgment as { sector_reasoning?: unknown }).sector_reasoning ?? '').toLowerCase()
    if (reasoningText.length > 0) {
      const hints: string[] = [command.ticker.toLowerCase()]
      const entityToken = (command.entity_name ?? '').split(/[\s,./]+/).find((w) => w.replace(/[^a-z0-9&']/gi, '').length >= 3)
      if (entityToken !== undefined) hints.push(entityToken.toLowerCase())
      if (!hints.some((h) => h.length > 0 && reasoningText.includes(h))) {
        entityMismatch = true
        passOk = false
      }
    }
  }
  const sectorStatus: ShariahGateSectorStatus = passOk && outcome.status === 'ok' ? outcome.shariah_judgment.sector_status : 'undetermined'
  const impermissibleIncome = passOk && outcome.status === 'ok' ? outcome.shariah_judgment.impermissible_income : null
  // The grounded WHY (dogfood find: a set-aside dossier must explain itself). Optional on legacy-shaped
  // outcomes; when present it is carried on the event AND folded into the human-facing reason strings.
  const sectorReasoning = passOk && outcome.status === 'ok' && typeof (outcome.shariah_judgment as { sector_reasoning?: unknown }).sector_reasoning === 'string'
    ? (outcome.shariah_judgment as { sector_reasoning: string }).sector_reasoning
    : undefined


  // Deterministic AAOIFI verdict when the inputs exist this early (code computes; the model only
  // supplied impermissible_income — null flows through as undetermined inside the ratio math).
  const ratioResult = deps.ratioInputs === undefined
    ? undefined
    : computeShariahFinancialRatios({ ...deps.ratioInputs, impermissible_income: impermissibleIncome ?? null })
  const ratioVerdict = ratioResult !== undefined && ratioResult.computable ? ratioResult.verdict : undefined

  const incomeNote = typeof impermissibleIncome === 'number' ? ` Impermissible income per the cited filing: $${impermissibleIncome.toLocaleString('en-US')}M.` : ''
  let allowed = true
  let reason = `shariah_gate_open: no hard stop — the deep dive may spend.${sectorReasoning === undefined ? '' : ` ${sectorReasoning}`}${incomeNote}`
  if (sectorStatus === 'non_compliant') {
    allowed = false
    reason = `shariah_gate_closed: the grounded sector judgment is NON-COMPLIANT — a hard stop before any lane spend.${sectorReasoning === undefined ? '' : ` ${sectorReasoning}`}${incomeNote}`
  } else if (ratioVerdict === 'FAIL') {
    allowed = false
    reason = `shariah_gate_closed: the deterministic AAOIFI financial ratios FAIL — a hard stop before any lane spend.${sectorReasoning === undefined ? '' : ` ${sectorReasoning}`}${incomeNote}`
  } else if (!passOk) {
    reason = entityMismatch
      ? `shariah_gate_open: the sector narrative did not mention ${command.ticker}${command.entity_name === undefined ? '' : ` / ${command.entity_name}`} — the response was discarded as a suspected wrong-company judgment (gate_incomplete). Proceeding; the downstream Shariah machinery still fails closed to UNDETERMINED.`
      : 'shariah_gate_open: the sector judgment could not be grounded (gate_incomplete) — proceeding; the downstream Shariah machinery still fails closed to UNDETERMINED.'
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
      ...(sectorReasoning === undefined ? {} : { sector_reasoning: sectorReasoning }),
      impermissible_income: impermissibleIncome,
      ...(ratioVerdict === undefined ? {} : { ratio_verdict: ratioVerdict }),
      ...(passOk ? {} : { gate_incomplete: true }),
      ...(entityMismatch ? { entity_mismatch_discarded: true } : {}),
      reason,
      corpus_source_ids: deps.corpusSourceIds,
      stage_cost: { provider_calls: 1, wall_ms: Date.now() - startedAt },
    },
    source_ids: passOk && outcome.status === 'ok' && typeof outcome.shariah_judgment.sector_citation === 'string' ? [outcome.shariah_judgment.sector_citation] : [],
    created_at: now(),
    schema_version: 1,
    idempotency_key: `shariah-gate:${command.research_case_id}:v1`,
  }
  const stored = await store.append(event as LedgerEventEnvelope<unknown>)

  return {
    allowed,
    reason,
    event_id: event.event_id,
    event: stored,
    ...(passOk && outcome.status === 'ok'
      ? {
          judgment: { sector_status: sectorStatus, impermissible_income: impermissibleIncome },
          pass_captured: outcome.captured,
        }
      : {}),
  }
}
