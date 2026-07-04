// Thesis RE-REVIEW (Phase 1): ONE grounded comparison pass — the same grounded machinery the lanes and
// the holding review use — that reads the NEW-FILINGS delta and compares it against the RECORDED prior
// thesis. Output is a DIFF (INTACT | WEAKENED | BROKEN), never a fresh verdict: the full re-verdict is
// the existing v2 supersession re-run, which a BROKEN diff points at.
//
// Why not scoped lane re-runs (the design doc's first sketch): specialist findings attach to a case
// version; appending fresh findings to an already-DECIDED case would silently mutate what the dossier
// presents as the decision's evidentiary basis (point-in-time integrity). The diff event lives in its
// own projection field and never touches findings/synthesis/decision.
//
// Fail-closed like everything else: an assessment whose evidence does not cite-verify degrades VISIBLY
// to UNVERIFIED (the payload enum is a superset of the model schema) — never a confident diff on
// unverified evidence. The pass only READS the prior case's bundle; it never writes its delta captures
// back (that would shrink future deltas' honesty and trip the ledger's read-before-write contract).

import { createHash } from 'node:crypto'

import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import type { Provider } from '@owlfolio/providers'
import { z } from 'zod'

import { ProposedSourcesSchema, runGroundedAgentWithTools, mergeReadCorpus, type GroundFn } from './groundedAgent'
import type { NewFilingsCheck, WeightedNewFiling } from './reReviewTrigger'
import { groundProposedSources, groundProposedSourcesDeterministic, mergeCapturedIntoCorpus, type CapturedSource, type GroundingDeps, type ProposedSource } from './sourceGrounding'
import { loadPersistedReadCorpus } from './sourceLedgerRead'

// ── Prior thesis ──────────────────────────────────────────────────────────────

export type PriorThesis = {
  research_case_id: string
  ticker?: string
  /** REQUIRED — no recorded thesis, no diff (fail-closed to undefined). */
  thesis_summary: string
  key_wrong_assumption?: string
  /** May be [] on legacy cases — the prompt then assesses the overall thesis only. */
  thesis_break_triggers: string[]
  investment_verdict?: string
  moat_class?: string
  buy_price_per_share?: number
  decided_at?: string
}

/**
 * Load the recorded prior thesis via the projection (the legacy-tolerant normalizer — never re-fold raw
 * events here). Fail-closed: unknown case, or a case without a recorded thesis_summary, → undefined.
 */
export function loadPriorThesis(
  events: LedgerEventEnvelope<unknown>[],
  researchCaseId: string,
): PriorThesis | undefined {
  const researchCase = projectResearchCases(events).find((c) => c.research_case_id === researchCaseId)
  if (researchCase === undefined) return undefined
  const thesis = researchCase.thesis_summary
  if (typeof thesis !== 'string' || thesis.trim().length === 0) return undefined
  return {
    research_case_id: researchCaseId,
    ...(researchCase.ticker === undefined ? {} : { ticker: researchCase.ticker }),
    thesis_summary: thesis,
    ...(researchCase.key_wrong_assumption === undefined ? {} : { key_wrong_assumption: researchCase.key_wrong_assumption }),
    thesis_break_triggers: researchCase.thesis_break_triggers ?? [],
    ...(researchCase.investment_verdict === undefined ? {} : { investment_verdict: researchCase.investment_verdict }),
    ...(researchCase.valuation?.moat_class === undefined ? {} : { moat_class: String(researchCase.valuation.moat_class) }),
    ...(typeof researchCase.valuation?.buy_price_per_share === 'number' ? { buy_price_per_share: researchCase.valuation.buy_price_per_share } : {}),
    ...(researchCase.updated_at === undefined ? {} : { decided_at: researchCase.updated_at }),
  }
}

// ── Model output schema ───────────────────────────────────────────────────────

export const ThesisReReviewSchema = z.object({
  overall_assessment: z.enum(['INTACT', 'WEAKENED', 'BROKEN']),
  trigger_assessments: z.array(z.object({
    /** Echo of a recorded thesis_break_trigger. */
    trigger: z.string().min(1),
    tripped: z.enum(['yes', 'no', 'unclear']),
    /** A source_id/content_hash from the NEW-filings corpus — cite-checked; 'unclear' may cite loosely. */
    evidence_citation: z.string().min(1),
    reasoning: z.string().min(1),
  })),
  changed_dimensions: z.array(z.enum(['growth', 'moat', 'management', 'financial_quality', 'valuation', 'shariah', 'other'])),
  weakened_dimension: z.string().optional(),
  broken_claim: z.string().optional(),
  narrative: z.string().min(1),
  source_ids: z.array(z.string().min(1)),
  proposed_sources: ProposedSourcesSchema,
})

/** Payload assessment is a SUPERSET of the model enum: fail-closed drafts degrade to UNVERIFIED. */
export type ReReviewAssessment = 'INTACT' | 'WEAKENED' | 'BROKEN' | 'UNVERIFIED'

/** Mirror of the interim-recency cap in the deep dive (RECENT_READABLE_MAX). */
export const MAX_RE_REVIEW_FILINGS = 6

const RE_REVIEW_TIMEOUT_MS = 120_000

// ── Idempotency (delta-content-keyed) ─────────────────────────────────────────

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Delta-content-keyed idempotency: the SAME set of new filings converges to one recorded re-review; a
 * changed delta (a newer filing) produces a new key and re-fires. Normalized URLs so query/hash noise
 * never double-fires.
 */
export function buildReReviewIdempotencyKey(researchCaseId: string, newFilings: readonly WeightedNewFiling[]): string {
  const urls = [...newFilings.map((f) => normalizeUrlKey(f.url))].sort()
  const digest = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12)
  return `re-review:${researchCaseId}:${digest}`
}

// ── The pass ──────────────────────────────────────────────────────────────────

export type ThesisReReviewRecordedPayload = {
  re_review_id: string
  research_case_id: string
  ticker?: string
  assessment: ReReviewAssessment
  trigger_assessments: { trigger: string; tripped: 'yes' | 'no' | 'unclear'; evidence_citation: string; reasoning: string }[]
  changed_dimensions: string[]
  weakened_dimension?: string
  broken_claim?: string
  narrative: string
  /** Display snapshot of what the diff compared against. */
  prior_thesis_summary: string
  /** The delta actually reviewed (capped) and what was skipped (cost honesty). */
  new_filings: WeightedNewFiling[]
  skipped_filings: WeightedNewFiling[]
  prior_corpus_size: number
  checked_at: string
  re_review_ungrounded?: boolean
  ungrounded_reason?: string
  reviewed_by_actor_type: 'provider'
  reviewed_by_actor_id: string
}

export type ThesisReReviewRecorded = LedgerEventEnvelope<ThesisReReviewRecordedPayload> & ThesisReReviewRecordedPayload

export type DraftThesisReReviewCommand = {
  research_case_id: string
  model_id: string
  causation_id: string
  source_ledger_path: string
  /** The Stage-A trigger result — the caller runs checkForNewFilings first (no double EDGAR fetch). */
  check: NewFilingsCheck
  idempotency_key?: string
}

export type DraftThesisReReviewDeps = {
  ground?: GroundFn
  grounding?: GroundingDeps
  maxToolCalls?: number
  now?: () => string
}

function formSlug(form: string): string {
  return form.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildReReviewPrompt(prior: PriorThesis, reviewed: { filing: WeightedNewFiling; source_id: string }[], priorCorpusIds: string[]): string {
  const triggerLines = prior.thesis_break_triggers.length > 0
    ? prior.thesis_break_triggers.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
    : '  (none recorded — assess the overall thesis only; trigger_assessments may be empty)'
  const filingLines = reviewed
    .map(({ filing, source_id }) => `  - ${filing.form} filed ${filing.filed} [${filing.weight} trigger]: read_source("${source_id}")`)
    .join('\n')
  const focusHints = 'Focus by form: 8-K/6-K → material events (impairments, guidance changes, executive departures, M&A, litigation); '
    + '10-Q → interim narrative trend vs the thesis dimensions (numbers are CONTEXT, never a revaluation); DEF 14A → compensation/governance/insider changes.'
  const priorCorpusLine = priorCorpusIds.length > 0
    ? `You MAY re-read the ORIGINAL decision sources for baseline comparison: ${priorCorpusIds.slice(0, 8).join(', ')}${priorCorpusIds.length > 8 ? ', …' : ''}.`
    : ''
  return [
    `You are the Buffett-Munger thesis RE-REVIEW agent for ${prior.ticker ?? prior.research_case_id}.`,
    'This is a DIFF against the recorded prior thesis, NOT a fresh verdict — compare, do not re-derive.',
    `RECORDED PRIOR THESIS${prior.decided_at === undefined ? '' : ` (decided ${prior.decided_at})`}: ${prior.thesis_summary}`,
    prior.key_wrong_assumption === undefined ? '' : `Key wrong-assumption on record: ${prior.key_wrong_assumption}.`,
    prior.investment_verdict === undefined ? '' : `Recorded verdict: ${prior.investment_verdict}${prior.moat_class === undefined ? '' : ` (moat: ${prior.moat_class})`}${prior.buy_price_per_share === undefined ? '' : `, buy-below ${prior.buy_price_per_share}`}.`,
    `RECORDED THESIS-BREAK TRIGGERS (assess EVERY one):\n${triggerLines}`,
    `NEW FILINGS since the decision (already fetched + content-verified — READ them with read_source):\n${filingLines}`,
    focusHints,
    priorCorpusLine,
    'For each recorded trigger return {trigger, tripped: yes|no|unclear, evidence_citation, reasoning} — a yes/no judgment MUST cite a verified NEW-filing source_id; use "unclear" when the new filings do not speak to the trigger.',
    'Set overall_assessment: INTACT (no load-bearing claim changed), WEAKENED (name the weakened_dimension), or BROKEN (name the broken_claim contradicted by the new filings).',
    'List every cited id in source_ids; cite ONLY verified ids. Return only the structured JSON fields.',
  ].filter((line) => line.length > 0).join(' ')
}

export async function draftThesisReReview(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  provider: Provider,
  command: DraftThesisReReviewCommand,
  deps: DraftThesisReReviewDeps = {},
): Promise<ThesisReReviewRecorded> {
  const now = deps.now ?? (() => new Date().toISOString())

  // Guards — the caller (route/task) must not invoke the pass in these states; throwing keeps the
  // failure legible and guarantees zero provider spend.
  if (command.check.no_prior_corpus) {
    throw new Error(`Re-review needs a persisted prior corpus for ${command.research_case_id} — a delta is not computable (no_prior_corpus). The honest refresh is a full re-run.`)
  }
  if (command.check.new_filings.length === 0) {
    throw new Error(`Re-review invoked with no new filings for ${command.research_case_id} — nothing to compare.`)
  }
  const events = await store.list()
  const prior = loadPriorThesis(events, command.research_case_id)
  if (prior === undefined) {
    throw new Error(`No recorded thesis for ${command.research_case_id} — a diff has nothing to compare against.`)
  }

  // Cap the delta strongest-first (the check is already ordered strong→weak, newest-first).
  const reviewedFilings = command.check.new_filings.slice(0, MAX_RE_REVIEW_FILINGS)
  const skippedFilings = command.check.new_filings.slice(MAX_RE_REVIEW_FILINGS)

  // Ground the delta harness-side (the deep-dive Slice-B pattern): deterministic ids, provenance stamps,
  // DEF 14A stamped 'proxy' (a real proxy filename carries no URL signal for the classifier).
  const ground: GroundFn = deps.ground ?? (
    provider.provider_id === 'mock-provider'
      ? groundProposedSourcesDeterministic as unknown as GroundFn
      : groundProposedSources as unknown as GroundFn
  )
  const proposed: ProposedSource[] = reviewedFilings.map((filing, i) => ({
    source_id: `rr_${formSlug(filing.form)}_${filing.filed}_${i}`,
    title: `${prior.ticker ?? command.research_case_id} ${filing.form} filed ${filing.filed} — SEC EDGAR`,
    url: filing.url,
    excerpt: `${filing.form} filed ${filing.filed} — new since the recorded decision.`,
  }))
  const grounded = await ground(proposed, deps.grounding)
  const verifiedSet = new Set(grounded.verified_ids)
  const deltaCaptures = grounded.captured
    .filter((c) => verifiedSet.has(c.source_id))
    .map((c, i) => {
      const filing = reviewedFilings[proposed.findIndex((p) => p.source_id === c.source_id)] ?? reviewedFilings[i]
      return filing === undefined
        ? c
        : { ...c, filed: filing.filed, form: filing.form, ...(filing.form === 'DEF 14A' ? { source_category: 'proxy' as const } : {}) }
    })
  const reviewed = reviewedFilings
    .map((filing, i) => ({ filing, source_id: proposed[i]!.source_id }))
    .filter((entry) => verifiedSet.has(entry.source_id))

  // Read corpus = the PRIOR persisted corpus (content-less → A1 re-fetch+hash-verify on read) overlaid
  // with the fresh delta captures. Pre-grounded wins on id collisions (mergeReadCorpus semantics).
  const priorCorpus = await loadPersistedReadCorpus({
    source_ledger_path: command.source_ledger_path,
    research_case_id: command.research_case_id,
  })
  const readCorpus = new Map<string, CapturedSource>(mergeReadCorpus(priorCorpus, []))
  mergeCapturedIntoCorpus(readCorpus, deltaCaptures)

  const { degraded_no_tools: _degraded, ...agent } = await runGroundedAgentWithTools(
    provider,
    {
      run_id: `run_${command.research_case_id}_re_review`,
      model_id: command.model_id,
      prompt: buildReReviewPrompt(prior, reviewed, [...priorCorpus.keys()]),
      timeout_ms: RE_REVIEW_TIMEOUT_MS,
      schema_name: 'BuffettMungerThesisReReview',
    },
    ThesisReReviewSchema,
    {
      ground,
      ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
      ...(deps.maxToolCalls === undefined ? {} : { maxToolCalls: deps.maxToolCalls }),
      readCorpus,
    },
  )
  void _degraded
  const structured = agent.analysis

  // Verified cite-check set: the delta captures + anything the loop itself verified (same hardened
  // primitive as the lanes / holding review).
  const verified = new Set<string>()
  for (const captured of [...deltaCaptures, ...agent.captured]) {
    if (captured.content_hash === undefined) continue
    verified.add(captured.content_hash)
    verified.add(captured.source_id)
  }
  for (const id of agent.verified_ids) verified.add(id)
  const groundedCitations = structured.source_ids.filter((id) => verified.has(id))

  // FAIL CLOSED: grounded only when (a) ≥1 verified source exists, (b) every DECISIVE (yes/no) trigger
  // assessment cites a verified source, and (c) the diff cites at least one verified id overall.
  const decisiveUncited = structured.trigger_assessments
    .filter((t) => t.tripped !== 'unclear' && !verified.has(t.evidence_citation))
  const isGrounded = verified.size > 0 && groundedCitations.length > 0 && decisiveUncited.length === 0
  const ungroundedReason = isGrounded
    ? undefined
    : decisiveUncited.length > 0
      ? `re_review_ungrounded: ${decisiveUncited.length} decisive trigger assessment(s) cite sources that did not verify — a yes/no judgment must cite verified NEW-filing evidence (fail-closed). Degraded to UNVERIFIED.`
      : 're_review_ungrounded: the pass produced no verified citations (fail-closed). Degraded to UNVERIFIED — never a confident diff on unverified evidence.'

  const reReviewId = `rr_${command.research_case_id}_${createHash('sha256')
    .update([...command.check.new_filings.map((f) => normalizeUrlKey(f.url))].sort().join('\n'))
    .digest('hex').slice(0, 12)}`

  const payload: ThesisReReviewRecordedPayload = {
    re_review_id: reReviewId,
    research_case_id: command.research_case_id,
    ...(prior.ticker === undefined ? {} : { ticker: prior.ticker }),
    assessment: isGrounded ? structured.overall_assessment : 'UNVERIFIED',
    trigger_assessments: structured.trigger_assessments,
    changed_dimensions: structured.changed_dimensions,
    ...(structured.weakened_dimension === undefined ? {} : { weakened_dimension: structured.weakened_dimension }),
    ...(structured.broken_claim === undefined ? {} : { broken_claim: structured.broken_claim }),
    narrative: structured.narrative,
    prior_thesis_summary: prior.thesis_summary,
    new_filings: reviewedFilings,
    skipped_filings: skippedFilings,
    prior_corpus_size: command.check.prior_corpus_size,
    checked_at: command.check.checked_at,
    ...(isGrounded || ungroundedReason === undefined ? {} : { re_review_ungrounded: true, ungrounded_reason: ungroundedReason }),
    reviewed_by_actor_type: 'provider',
    reviewed_by_actor_id: provider.provider_id,
  }

  const event: LedgerEventEnvelope<ThesisReReviewRecordedPayload> = {
    event_id: `evt_research_case_re_review_recorded_${reReviewId}`,
    event_type: 'research_case_re_review_recorded',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload,
    // Verified citations only — never the model's raw source_ids.
    source_ids: groundedCitations,
    created_at: now(),
    schema_version: 1,
    idempotency_key: command.idempotency_key ?? buildReReviewIdempotencyKey(command.research_case_id, command.check.new_filings),
  }

  const stored = await store.append(event as LedgerEventEnvelope<unknown>)
  const storedTyped = stored as LedgerEventEnvelope<ThesisReReviewRecordedPayload>
  return { ...storedTyped, ...storedTyped.payload }
}
