import { z } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { runGroundedAgentWithRetry, ProposedSourcesSchema, type GroundFn } from './groundedAgent'
import { AGENT_TIMEOUT_MS } from './researchSwarmSchemas'
import type { GroundingDeps } from './sourceGrounding'

// ---------------------------------------------------------------------------
// Task 4.2a — the ADMIT-JUDGMENT forcing layer (candidate → watched gate).
//
// Phase 4 admits a name only after the hardest judgment: the name is cheap because something went
// WRONG — is that wrong thing FIXABLE (temporary, recoverable) or TERMINAL (permanent impairment)?
//
// The research swarm reasons about business QUALITY in the abstract (moat/financials/risk/synthesis).
// No existing lane makes the cheapness-cause-fixability call. Composing the existing verdict would
// produce a HOLLOW artifact (a quality verdict dressed as an impairment judgment) and let the eroders
// (ADBE/CRM/WDAY-shaped: passes quality, terminally impaired) slip through. This is a THIN forcing
// layer that makes the impairment call EXPLICIT.
//
// The Pabrai-Principle-7 split: the opportunity lives where UNCERTAINTY is high but PERMANENT-LOSS
// RISK is low (Frontline: ~90% price drop, but non-recourse debt + $9-10 liquidation value vs $3
// price → high uncertainty, low permanent-loss). A single "is it a value trap?" field would let a
// fluent agent BLUR exactly the distinction that matters, so the judgment carries `uncertainty` and
// `permanent_loss_risk` as SEPARATE, grounded fields. The value trap hides specifically in a LOW
// stated permanent-loss-risk that is actually HIGH — so the bear case attacks the permanent-loss claim.
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high'
export type ImpairmentCall = 'fixable_temporary' | 'permanent_impairment' | 'unresolved'

// ---------------------------------------------------------------------------
// Part A — classifyAdmit: the PURE deterministic forcing function (no I/O).
//
// THE FORCING RULE (deterministic, regardless of how good the quality verdict is):
//   1. permanent_loss_risk === 'high'  ⇒ permanent_impairment, NOT admittable — EVEN IF quality passes
//      (anti-hollow: a great quality verdict cannot rescue a terminally impaired name; the eroder case).
//   2. quality_verdict_passes === false ⇒ NOT admittable regardless (cheapness on a non-wonderful
//      business is not the signal).
//   3. permanent_loss_risk === 'low' AND quality passes ⇒ fixable_temporary, admittable — high
//      uncertainty here is FINE (it IS the opportunity; the Frontline/temporary-stumble case).
//   4. permanent_loss_risk === 'medium' ⇒ unresolved, NOT admittable (don't admit on a maybe).
//
// Note rule precedence: the high-permanent-loss anti-hollow rule (1) is checked BEFORE the quality
// gate (2) so that the `reason` for a terminally-impaired name names the impairment — but both still
// yield not-admittable, so order only affects the reason string, never the admit decision.
// ---------------------------------------------------------------------------

export function classifyAdmit(args: {
  uncertainty: RiskLevel
  permanent_loss_risk: RiskLevel
  /** Did the research swarm say it's a good business? */
  quality_verdict_passes: boolean
}): { impairment_call: ImpairmentCall; admittable: boolean; reason: string } {
  const { uncertainty, permanent_loss_risk, quality_verdict_passes } = args

  // Rule 1 (anti-hollow, highest precedence): high permanent-loss is terminal — a passing quality
  // verdict cannot rescue it. This is the eroder case (ADBE/CRM/WDAY-shaped).
  if (permanent_loss_risk === 'high') {
    return {
      impairment_call: 'permanent_impairment',
      admittable: false,
      reason:
        'permanent_loss_risk is HIGH — the cheapness cause is terminal (permanent impairment). '
        + 'Not admittable even when the quality verdict passes (a great business cannot rescue a permanently impaired name).',
    }
  }

  // Rule 2: cheapness on a non-wonderful business is not the signal.
  if (!quality_verdict_passes) {
    return {
      impairment_call: 'unresolved',
      admittable: false,
      reason: 'quality_verdict_passes is FALSE — cheapness on a business the swarm did not call wonderful is not the signal; not admittable.',
    }
  }

  // Rule 3: low permanent-loss + passing quality = the opportunity. High UNCERTAINTY does NOT block
  // admit — only permanent-loss risk does (the Pabrai-Principle-7 split).
  if (permanent_loss_risk === 'low') {
    return {
      impairment_call: 'fixable_temporary',
      admittable: true,
      reason:
        `permanent_loss_risk is LOW and the quality verdict passes — the cheapness cause looks fixable/temporary. `
        + `High uncertainty (here: ${uncertainty}) is the opportunity, not a blocker; admittable.`,
    }
  }

  // Rule 4: medium permanent-loss — don't admit on a maybe.
  return {
    impairment_call: 'unresolved',
    admittable: false,
    reason: 'permanent_loss_risk is MEDIUM — the fixable-vs-terminal question is unresolved; do not admit on a maybe (needs more work).',
  }
}

// ---------------------------------------------------------------------------
// Part B — runAdmitJudgment: the provider-driven step that FEEDS classifyAdmit.
//
// The schema FORCES `uncertainty` and `permanent_loss_risk` as SEPARATE, grounded fields — each
// REQUIRES a level, an argument, and >=1 citation. A missing field or empty citations array fails
// the Zod parse (the forcing function at the contract layer; provider.structured throws on mismatch).
// ---------------------------------------------------------------------------

const RiskLevelSchema = z.enum(['low', 'medium', 'high'])

/** A grounded risk judgment: level + argument + >=1 citation (citations cite-checked by the harness). */
const GroundedRiskFieldSchema = z.object({
  level: RiskLevelSchema,
  argument: z.string().min(1),
  // >=1 citation REQUIRED — an ungrounded risk claim is rejected at the contract layer.
  citations: z.array(z.string().min(1)).min(1),
})

export const AdmitJudgmentSchema = z.object({
  // The two SEPARATE grounded fields — the Pabrai-Principle-7 split made structural.
  uncertainty: GroundedRiskFieldSchema,
  permanent_loss_risk: GroundedRiskFieldSchema,
  proposed_sources: ProposedSourcesSchema,
})

export type AdmitJudgmentAnalysis = z.infer<typeof AdmitJudgmentSchema>

/**
 * Step-1 schema — the INDEPENDENT impairment bear case, generated from the filings COLD (its own
 * provider call, NOT handed the bull/quality narrative). It is a separate contract precisely so the
 * bear case cannot be a field smuggled out of the bull-context judgment call.
 */
export const AdmitBearCaseSchema = z.object({
  impairment_bear_case: z.string().min(1),
  proposed_sources: ProposedSourcesSchema,
})

export type AdmitBearCaseAnalysis = z.infer<typeof AdmitBearCaseSchema>

/** A grounded risk field on the persisted recommendation (citations are post-cite-check). */
export type GroundedRiskField = {
  level: RiskLevel
  argument: string
  citations: string[]
}

/** The admit recommendation surfaced to the human. NO auto-admit — the human admits in task 4.2b. */
export type AdmitRecommendation =
  | {
      status: 'complete'
      uncertainty: GroundedRiskField
      permanent_loss_risk: GroundedRiskField
      /** Independent impairment bear case (impairment-from-filings, routed at the permanent-loss claim). */
      impairment_bear_case: string
      impairment_call: ImpairmentCall
      /** RECOMMENDATION flag only — nothing transitions the name here. */
      admittable: boolean
      reason: string
      /** The Phase-1 buy-below carried through from args.valuation (when known). */
      buy_below?: number
      /** source_ids cited by a risk field that were NOT in the verified corpus (recorded, never hidden). */
      uncited_refs?: string[]
    }
  | {
      status: 'admit_judgment_incomplete'
      reason: string
    }

// Per-agent call timeout. Default 600s — real frontier-reasoning provider calls (e.g. Codex CLI
// grounded lanes reading EDGAR) routinely exceed the old 180s; a single timed-out call aborts the
// whole ~10-call swarm. Override with OWLFOLIO_AGENT_TIMEOUT_MS. Single source of truth lives in
// researchSwarmSchemas.

/** Compact lane finding the judgment reasons from (same shape as the red-team digest). */
export type AdmitLaneDigest = {
  lane: string
  finding_summary: string
  confidence: string
}

export type RunAdmitJudgmentArgs = {
  research_case_id: string
  ticker: string
  /** The model the judgment runs on. Defaults to the run's model. */
  model_id: string
  /** Did the research swarm call this a good business? Fed straight to classifyAdmit. */
  quality_verdict_passes: boolean
  laneDigest: AdmitLaneDigest[]
  /** Why this name surfaced as cheap (the cheapness screen's summary) — frames the "why cheap" question. */
  cheapness_summary: string
  /** The verified source corpus (source_ids) the judgment must cite from. */
  corpusSourceIds: string[]
  /** Hashes/source_ids verified against the fetched corpus — used to cite-check the risk fields. */
  verifiedCitationHashes: ReadonlySet<string>
  /** Phase-1 valuation outputs carried through to the recommendation. */
  valuation?: { buy_below?: number }
}

/**
 * Build the INDEPENDENT impairment bear-case framing. This is the load-bearing difference from the
 * red-team pass: redTeamPass takes the case digest and ATTACKS the bull thesis (critique-the-thesis).
 * Here the bear case argues PERMANENT IMPAIRMENT *from the filings cold* — "the cheapness cause is
 * terminal" — and is routed specifically at the `permanent_loss_risk` claim (where the value trap
 * hides). It is NOT handed the bull/admit thesis to poke holes in.
 */
export function buildAdmitBearPrompt(args: RunAdmitJudgmentArgs): string {
  const corpus = args.corpusSourceIds.join(', ')
  return (
    `INDEPENDENT IMPAIRMENT BEAR CASE for ${args.ticker} — argue, from the FILINGS cold, why this name is `
    + `PERMANENTLY IMPAIRED. Do NOT critique a bull thesis and do NOT poke holes in the admit case — you are not `
    + `given one. Build the strongest case that the cheapness cause is TERMINAL, not a temporary stumble: the `
    + `business is structurally/permanently impaired and the discount reflects a smaller intrinsic value, not a `
    + `recoverable one. Route this case specifically at the PERMANENT_LOSS_RISK claim — the value trap hides in a `
    + `LOW permanent-loss-risk that is actually HIGH, so attack any claim that permanent loss is low. Ground every `
    + `assertion in the filings: cite the verified corpus (${corpus}). An uncited impairment claim will be dropped.`
  )
}

/**
 * Step-2 judgment prompt. It legitimately needs the quality verdict + lanes to assess uncertainty and
 * permanent_loss_risk — BUT it is also FED the independent impairment bear case from Step 1 (generated
 * from the filings cold) so the `permanent_loss_risk` assessment is PRESSURE-TESTED by an argument that
 * was NOT built by critiquing the bull thesis. The judgment does NOT emit the bear case (Step 1 owns it).
 */
function buildAdmitJudgmentPrompt(args: RunAdmitJudgmentArgs, independentBearCase: string): string {
  const laneLines = args.laneDigest
    .map((l) => `  - ${l.lane} (${l.confidence}): ${l.finding_summary}`)
    .join('\n')
  const corpus = args.corpusSourceIds.join(', ')
  return (
    `You are the Buffett-Munger ADMIT-JUDGMENT agent for ${args.ticker}. This name surfaced as CHEAP: `
    + `${args.cheapness_summary}\n\n`
    + `The research swarm ${args.quality_verdict_passes ? 'PASSED' : 'did NOT pass'} this business on quality.\n\n`
    + `Lane findings:\n${laneLines}\n\n`
    + `An INDEPENDENT impairment bear case was generated SEPARATELY from the filings cold (it did NOT see this `
    + `quality verdict or these lane findings). Pressure-test your permanent_loss_risk assessment against it — `
    + `do not dismiss it because the bull case is strong:\n"""\n${independentBearCase}\n"""\n\n`
    + `Your job is the HARDEST judgment: the name is cheap because something went WRONG — is that wrong thing `
    + `FIXABLE (temporary, recoverable) or TERMINAL (permanent impairment)? Separate the two axes that a single `
    + `"value trap?" verdict would blur:\n`
    + `  - uncertainty: how UNKNOWABLE the outcome is. HIGH uncertainty is fine — it is often the opportunity.\n`
    + `  - permanent_loss_risk: the risk of PERMANENT capital loss (intrinsic value truly smaller, not just `
    + `unknown). This is the axis that decides admit. The value trap is a LOW stated permanent-loss-risk that is `
    + `actually HIGH.\n\n`
    + `Emit BOTH as SEPARATE grounded fields: each REQUIRES a level (low|medium|high), an argument, and >=1 `
    + `citation. GROUNDING (non-negotiable): cite ONLY the verified corpus (${corpus}); return them in `
    + `proposed_sources with real URLs. An ungrounded risk claim will be rejected.`
  )
}

/**
 * Cite-check a grounded risk field's citations against the verified corpus: keep only citations present
 * in the verified set; record the rest (never hide them). Mirrors redTeamPass.citeCheckObjection.
 */
function citeCheckRiskField(
  field: AdmitJudgmentAnalysis['uncertainty'],
  verified: ReadonlySet<string>,
): { citations: string[]; uncited: string[] } {
  const citations: string[] = []
  const uncited: string[] = []
  for (const c of field.citations) {
    if (verified.has(c)) citations.push(c)
    else uncited.push(c)
  }
  return { citations, uncited }
}

/**
 * Run the provider-driven admit judgment, then feed classifyAdmit. Returns an AdmitRecommendation —
 * a RECOMMENDATION surfaced to the human (NO auto-admit; the human admits in task 4.2b). On a
 * timeout/failure (after the grounded retry) it DEGRADES to `admit_judgment_incomplete` rather than
 * aborting — the impairment call is too important to silently drop, so the incomplete state is visible.
 *
 * The schema (AdmitJudgmentSchema) forces `uncertainty` and `permanent_loss_risk` as separate grounded
 * fields with >=1 citation each — provider.structured throws if either is missing or uncited, so a
 * value-trap-blurring output cannot pass the contract layer.
 */
export async function runAdmitJudgment(
  provider: Provider,
  args: RunAdmitJudgmentArgs,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<AdmitRecommendation> {
  // STEP 1 — the INDEPENDENT impairment bear case (its OWN provider call). It is fed ONLY the corpus /
  // cheapness context via buildAdmitBearPrompt; it does NOT receive quality_verdict_passes, the lane
  // digest, or any bull/admit thesis — so it argues impairment from the filings COLD (not critique-the-
  // thesis). If THIS call fails, we fail-closed: the judgment is too important to proceed with no bear
  // case, so we degrade VISIBLY rather than fabricating a clean admit.
  let bearCase: string
  try {
    const bear = await runGroundedAgentWithRetry(
      provider,
      {
        run_id: `run_${args.research_case_id}_admit_bear_case`,
        model_id: args.model_id,
        prompt: buildAdmitBearPrompt(args),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerAdmitBearCase',
      },
      AdmitBearCaseSchema,
      deps,
    )
    bearCase = bear.analysis.impairment_bear_case
  } catch (error) {
    return {
      status: 'admit_judgment_incomplete',
      reason: `independent impairment bear case failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // STEP 2 — the admit judgment (uncertainty + permanent_loss_risk grounded fields). It legitimately
  // gets the quality verdict + lanes, AND is fed the Step-1 independent bear case so permanent_loss_risk
  // is pressure-tested by an argument NOT built from the bull thesis.
  let agent
  try {
    agent = await runGroundedAgentWithRetry(
      provider,
      {
        run_id: `run_${args.research_case_id}_admit_judgment`,
        model_id: args.model_id,
        prompt: buildAdmitJudgmentPrompt(args, bearCase),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerAdmitJudgment',
      },
      AdmitJudgmentSchema,
      deps,
    )
  } catch (error) {
    return {
      status: 'admit_judgment_incomplete',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  const a = agent.analysis
  const uCheck = citeCheckRiskField(a.uncertainty, args.verifiedCitationHashes)
  const pCheck = citeCheckRiskField(a.permanent_loss_risk, args.verifiedCitationHashes)

  // Feed the PURE deterministic classifier — the forcing function decides admit, not the model.
  const classified = classifyAdmit({
    uncertainty: a.uncertainty.level,
    permanent_loss_risk: a.permanent_loss_risk.level,
    quality_verdict_passes: args.quality_verdict_passes,
  })

  const uncited = [...uCheck.uncited, ...pCheck.uncited]
  const buyBelow = args.valuation?.buy_below

  return {
    status: 'complete',
    uncertainty: { level: a.uncertainty.level, argument: a.uncertainty.argument, citations: uCheck.citations },
    permanent_loss_risk: {
      level: a.permanent_loss_risk.level,
      argument: a.permanent_loss_risk.argument,
      citations: pCheck.citations,
    },
    impairment_bear_case: bearCase,
    impairment_call: classified.impairment_call,
    admittable: classified.admittable,
    reason: classified.reason,
    ...(buyBelow === undefined ? {} : { buy_below: buyBelow }),
    ...(uncited.length > 0 ? { uncited_refs: uncited } : {}),
  }
}
