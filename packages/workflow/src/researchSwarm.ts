import { z } from 'zod'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { resolveProvider, type Provider } from '@owlfolio/providers'
import {
  resolveModelForRole,
  type ModelRoleId,
  type ModelRoleOverride,
} from '@owlfolio/strategies/modelRegistry'
import {
  sanitizeRoicLike,
  sanitizeReinvestmentRate,
} from './rangeSanity'
import { runValidatedAgent, ValidatedAgentFailedError, type RequiredFieldCheck } from './runValidatedAgent'
// Shared CONSTS/clamps only (defaults + bounds for the circle-gate knobs) — the workflow package never
// LOADS app config; callers resolve settings and thread them via the command.
import { clampCircleGateKSamples, clampCircleGateMinBreakers, clampCircleGateMinDrivers } from '@owlfolio/shared/appConfig'
import { groundProposedSources, isCitationGrounded, mergeCapturedIntoCorpus, type CapturedSource, type GroundingDeps, type ProposedSource, type SourcePolicyRejection } from './sourceGrounding'
// Grounded-agent primitives live in a cycle-free module (groundedAgent) so BOTH this orchestrator AND
// the red-team pass can import them without a circular module-evaluation dependency. Re-exported below
// for existing importers (tests + workers import these from researchSwarm).
import {
  ProposedSourceSchema,
  ProposedSourcesSchema,
  runGroundedAgent,
  runGroundedAgentWithRetry,
  runGroundedAgentWithTools,
  SynthesisResponseSchema,
  type GroundFn,
  type GroundedAgentRequest,
  type GroundedAgentResult,
  type SynthesisResponse,
} from './groundedAgent'
export {
  ProposedSourceSchema,
  ProposedSourcesSchema,
  runGroundedAgent,
  runGroundedAgentWithRetry,
  runGroundedAgentWithTools,
  SynthesisResponseSchema,
  type GroundFn,
  type GroundedAgentRequest,
  type GroundedAgentResult,
  type SynthesisResponse,
}
import { capexVsDandANote, computeIncrementalRoic, demonstratedOwnerEarningsGrowth, selectLatestAnnualFiling, selectLatestProxyFiling, selectRecentReadableFilings, type Fundamentals, type ImpermissibleIncomeLine, type SecEdgarDeps } from './secEdgar'
import { resolveInsiderSummary, type InsiderSummary, type InsiderSummaryComputed } from './secForm4'
import { resolveFundamentalsForTicker } from './fundamentalsProvider'
import { evaluateBaseRateBurden, type BaseRateBurdenFlag } from './baseRateBurden'
import { computeMoatTests, type MoatTests } from './moatTests'
import { buildManagementTalentBlock, computeManagementTalentT0, type ManagementTalentT0 } from './managementT0'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { fcfImpliedExitMultiple, fcfImpliedGrowth, fcfIntrinsicValuePerShare, resolveExitMultiple } from '@owlfolio/strategies/bookValuation'
import { yearFcf } from './annualRatios'
import { runRetainedEarningsTest, type RetainedEarningsTestResult } from './retainedEarningsTest'
import { BASE_RATES } from '@owlfolio/strategies/baseRates'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'
import { SOURCE_POLICY } from '@owlfolio/strategies/sourcePolicy'
import { createResearchCase, draftDecision } from './researchWorkflow'
import {
  buffettMungerDeepDiveLanes,
  queueDeepDive,
  startDeepDive,
  recordSpecialistFinding,
  draftDeepDiveSynthesis,
  completeDeepDive,
} from './strategyResearchPipeline'
import { ingestManualSourceBundle, type ManualUrlEvidenceSourceInput } from './sourceLedger'
import { resolveResearchStrategyRef } from './researchStrategyRef'
import { buffettMungerStrategy, creditedGrowth, MANAGEMENT_PILLAR_POLICY, moatPassesGate } from '@owlfolio/strategies/buffettMunger'
import { curatedAdrRatio } from '@owlfolio/strategies/adrRatios'
import { computeShariahFinancialRatios } from '@owlfolio/strategies/shariahFinancialRatios'
// NOTE (R1): sustainableGrowthBand + requiredGrowthGap are no longer imported here — the relightened
// decision stopped using the band/gap engines (they are deleted entirely in R2). The model now proposes
// the verdict + valuation + buy-below; the deterministic side only sanity-checks + applies the cheap gates.
import { fetchAverageMarketCap, fetchFxRateToUsd, marketCapInReportingCurrency, resolveCurrentPrice, type AverageMarketCapResult, type MarketDataDeps, type PriceQuote } from './marketData'
import { runInversionPass, buildInversionLayer, type InversionLaneDigest, type InversionResult } from './inversionPass'
import { runValuationReasoningPass, type ValuationReasoning } from './valuationReasoningPass'
import { runShariahGatePhase } from './shariahGatePhase'
import { runShariahReasoningPass } from './shariahReasoningPass'
import {
  resolveCrossCheck,
  compareMoatClass,
  compareShariahSectorStatus,
  type CrossCheckLayer,
  type MoatClass,
  type ShariahSectorStatus,
} from './dualModelCrossCheck'
import {
  LaneAgentSchema,
  MoatLaneSchema,
  ManagementLaneSchema,
  DecisionAgentSchema,
  MoatCrossCheckSchema,
  ShariahCrossCheckSchema,
  CircleCompetenceSchema,
  AGENT_TIMEOUT_MS,
  MOAT_PILLAR_PROMPT,
  MANAGEMENT_PILLAR_PROMPT,
  UNDERSTAND_PILLAR_PROMPT,
  UnderstandLaneSchema,
  CIRCLE_COMPETENCE_PROMPT,
  RISKS_RECENCY_NOTE,
  PRIMARY_FILING_LANES,
} from './researchSwarmSchemas'
// Deterministic harness compute (judgment-tier resolution, projection builders, OE-bridge filing block,
// maintenance-capex tier fraction) lives in a pure-compute module. Re-exported below for existing
// importers (the researchSwarm test imports resolveJudgmentTiers + the judgment types from here).
import {
  parseLaneArguedGrowth,
  resolveJudgmentTiers,
  buildJudgmentProjection,
  resolveEngineCommit,
  buildPrimaryFilingBlock,
  buildProxyBlock,
  buildInsiderBlock,
  buildRecentFilingsBlock,
  buildPreVerifiedSourcesBlock,
  resolveManagementJudgment,
  type ManagementLaneThesis,
  type ResolvedManagementJudgment,
  type MoatLaneJudgment,
  type ShariahLaneJudgment,
  type JudgmentDegraded,
  type JudgmentResolution,
} from './researchSwarmCompute'
export {
  resolveJudgmentTiers,
  type MoatLaneJudgment,
  type ShariahLaneJudgment,
  type JudgmentDegraded,
  type JudgmentResolution,
}

/**
 * Structured failure raised when a bookend swarm call (quick-screen or synthesis) fails after its
 * retry. Carries the stage and whether lane findings were already persisted so the caller / worker
 * can record a clean `research_run_failed` and (for synthesis) know the lanes are resumable.
 */
export class ResearchSwarmStageError extends Error {
  readonly stage: 'quick_screen' | 'synthesis'
  readonly lanes_completed: boolean
  constructor(stage: 'quick_screen' | 'synthesis', cause: unknown, opts: { lanes_completed?: boolean } = {}) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    const laneNote = opts.lanes_completed
      ? ' Lane findings were persisted before synthesis and can be resumed/retried.'
      : ''
    super(`Research swarm ${stage} stage failed after retry: ${reason}.${laneNote}`)
    this.name = 'ResearchSwarmStageError'
    this.stage = stage
    this.lanes_completed = opts.lanes_completed ?? false
    if (cause instanceof Error) this.cause = cause
  }
}

/** The book's one-pager (B3) as the lane emits it — carried verbatim to the payload + dossier. */
export type OnePagerOutput = {
  plain_english: string
  segments: string[]
  revenue_drivers: string[]
  most_profitable_segments: string[]
  strengths: string[]
  weak_spots: string[]
  growth_levers: string[]
}

export type LaneOutcome = {
  lane: string
  finding_summary: string
  confidence: 'low' | 'medium' | 'high'
  caveats: string[]
  verified_ids: string[]
  /** Mechanism 6: sources this lane proposed that the source-discipline whitelist rejected. */
  policy_rejections?: SourcePolicyRejection[]
  /** MOAT lane only: its rubric/holistic judgment (spec-correct: the lane scores its own rubric). */
  moat_judgment?: MoatLaneJudgment
  /** MANAGEMENT lane only (S5): its raw integrity/talent judgment blocks (resolved by the harness). */
  management_judgment?: ManagementLaneThesis
  /** UNDERSTAND lane only (B3): the book's seven-item one-pager distillation (display verbatim). */
  one_pager?: OnePagerOutput
  /** Visible per-lane degradation: the lane omitted its REQUIRED judgment block after schema-retry. */
  judgment_retry_degraded?: string
  /** Phase 2 V5 — stage-cost inputs (tokens reported by the provider + wall time for this lane). */
  usage?: { input_tokens?: number; output_tokens?: number }
  wall_ms?: number
}

export type LaneSwarmResult = LaneOutcome & { status: 'complete' | 'incomplete' }

export async function runLaneSwarm(
  lanes: readonly string[],
  runLane: (lane: string) => Promise<LaneOutcome>,
  opts: { concurrency?: number } = {},
): Promise<LaneSwarmResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const results: LaneSwarmResult[] = new Array(lanes.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < lanes.length) {
      const index = cursor++
      const lane = lanes[index]
      if (lane === undefined) continue
      try {
        results[index] = { ...(await runLane(lane)), status: 'complete' }
      } catch (error) {
        results[index] = {
          lane,
          finding_summary: `${lane} lane did not complete: ${(error as Error).message}. Verify before any user decision.`,
          confidence: 'low',
          caveats: ['Lane incomplete — not investment-grade; re-run before relying on it.'],
          verified_ids: [],
          status: 'incomplete',
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, lanes.length) }, worker))
  return results
}

// ---------------------------------------------------------------------------
// Swarm orchestrator type aliases
// ---------------------------------------------------------------------------

type SwarmStore = EventStore<LedgerEventEnvelope<unknown>>

// ---------------------------------------------------------------------------
// Command type
// ---------------------------------------------------------------------------

/**
 * Circle-gate hardening settings (owner-editable via app-config automation settings, threaded by the
 * web/worker caller — the workflow package never loads config). All optional; absent fields fall back
 * to the shared DEFAULT_CIRCLE_GATE_* consts so caller omission cannot soften the gate.
 */
export type CircleGateSettings = {
  /** Independent gate samples per run; deep dive entered only on a UNANIMOUS in-competence vote. */
  k_samples?: number
  /** Minimum GROUNDED cashflow drivers a sample must carry for its judgment to count. */
  min_drivers?: number
  /** Minimum GROUNDED predictability breakers a sample must carry for its judgment to count. */
  min_breakers?: number
}

export type RunStrategyResearchSwarmCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version?: string
  actor_id: string
  idempotency_key?: string
  model_id: string
  decision_id: string
  source_ledger_path: string
  version?: number
  supersedes_research_case_id?: string
  /** Circle-gate hardening knobs (k-sample agreement + evidence floors), forwarded to the deep dive. */
  circle_gate?: CircleGateSettings
  /**
   * F.2 — the COMPLIANT risk-free SAVINGS rate (decimal) from the app-config savings sleeve, the
   * valuation discount anchor. Forwarded to the deep-dive phase (previously only the approval-RESUME
   * path carried it, so automatic-mode runs always failed closed to the default).
   */
  risk_free_rate?: number
  /**
   * Phase 4 (book alignment) — the REQUIRED RETURN (decimal) used to discount the 10-year FCF
   * valuation, from the app-config valuation setting. Omitted / invalid → fails closed to the flat
   * 15% book default (`required_return_default`).
   */
  required_return?: number
  /** Controls deep-dive gating.
   *  'automatic' (default): quick screen → deep dive → decision in one run.
   *  'review': quick screen → pause (deep_dive_approval_pending) → return without running deep dive.
   */
  deep_dive_approval?: 'automatic' | 'review'
  /** model-tiering: optional per-role provider/model overrides (registry). Omitted = single-provider default. */
  model_overrides?: Partial<Record<ModelRoleId, ModelRoleOverride>>
  /**
   * model-tiering: the env source the registry reads `OWLFOLIO_MODEL_ROLE_<ROLE>` from. The web/worker
   * build this from the UI-managed env FILE merged over process.env (file wins), so file-configured
   * tiers take effect. Omitted = `process.env` (the historical default — resolver behavior unchanged).
   */
  model_role_env?: Record<string, string | undefined>
  /**
   * S6 — USER-AUTHORED moat-gate override ("run remaining pillars anyway"): skips the EARLY moat-gate
   * short-circuit so Pillars 3–4 run on a below-gate name. The LATE verdict rails are unchanged (the
   * verdict still gates to PASS/RESEARCH_MORE) — the override buys the full analysis, never a pass.
   */
  moat_gate_override?: boolean
}

export type RunResearchDeepDivePhaseCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version?: string
  model_id: string
  decision_id: string
  source_ledger_path: string
  /** Source ids verified at the front Shariah gate (legacy: the quick screen) — seed queueDeepDive */
  gate_source_ids: string[]
  /** event_id of the shariah_gate_judged event (legacy: quick_screen_drafted) — used as causation_id */
  gate_event_id: string
  /**
   * F.2 — the COMPLIANT risk-free SAVINGS rate (Mudarabah expected profit, decimal) from the app-config
   * savings sleeve (`savings_expected_profit_rate`), used as the discount risk-free anchor. The SAME
   * baseline the deployment-hurdle + sizing engines use. Omitted / non-finite / non-positive → the discount
   * fails closed to `savings_rate_default` (the Treasury anchor is retired).
   */
  risk_free_rate?: number
  /** Phase 4 — the required return for the FCF valuation (defaults to the flat 15% book hurdle). */
  required_return?: number
  /** model-tiering: optional per-role provider/model overrides (registry). Omitted = single-provider default. */
  model_overrides?: Partial<Record<ModelRoleId, ModelRoleOverride>>
  /**
   * model-tiering: the env source the registry reads `OWLFOLIO_MODEL_ROLE_<ROLE>` from (env FILE merged
   * over process.env, file wins). Omitted = `process.env` (historical default).
   */
  model_role_env?: Record<string, string | undefined>
  /** Circle-gate hardening knobs (k-sample agreement + evidence floors). Absent → shared defaults. */
  circle_gate?: CircleGateSettings
  /**
   * S3 — the deep-dive approval pause ('review' pauses AFTER the shariah + circle gates pass and
   * BEFORE lane spend; the approval-resume path omits it). Absent → 'automatic'.
   */
  deep_dive_approval?: 'automatic' | 'review'
  /** S6 — skip the EARLY moat-gate short-circuit (user-authored override; the late rails still gate). */
  moat_gate_override?: boolean
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function swarmSeg(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * Map captured sources to source-ledger inputs — the ONE mapping shared by every ingest site, carrying
 * the Axis B cross-run enrichment (source_category / filed / form→filing_form / fetched_at) as TYPED
 * TOP-LEVEL fields (the metadata sanitizer silently drops '/'-containing strings like '8-K/A'). The
 * cross-run resolver (sourceLedgerRead) reads these back to rebuild a lane-gated read corpus. Document
 * CONTENT is never mapped — the ledger persists pointers + hashes only.
 */
function toLedgerSourceInputs(captured: CapturedSource[], researchCaseId: string): ManualUrlEvidenceSourceInput[] {
  return captured.map((c) => ({
    source_id: c.source_id,
    kind: 'url' as const,
    title: c.title,
    url: c.url,
    excerpt: c.excerpt,
    availability: c.availability,
    ...(c.content_hash === undefined ? {} : { content_hash: c.content_hash }),
    ...(c.source_category === undefined ? {} : { source_category: c.source_category }),
    ...(c.form === undefined ? {} : { filing_form: c.form }),
    ...(c.filed === undefined ? {} : { filed: c.filed }),
    fetched_at: c.fetched_at,
    metadata: {
      research_case_id: researchCaseId,
      ...(c.http_status === undefined ? {} : { http_status: c.http_status }),
    },
  }))
}

// ---------------------------------------------------------------------------
// model-tiering-spec — per-role model/provider resolution (the registry, not hardcoded names)
// ---------------------------------------------------------------------------

/**
 * Resolve the provider + model + timeout for a swarm ROLE via the model registry. No hardcoded model
 * name lives in the pipeline — each stage asks the registry. By DEFAULT every role inherits the run's
 * active provider/model (so single-provider Codex/mock runs are unchanged), but a per-role override
 * (command.model_overrides or OWLFOLIO_MODEL_ROLE_<ROLE> env) can pin a role onto a DIFFERENT
 * provider/model — e.g. running red_team or lane_moat on a second model. When a role resolves to a
 * provider_id DIFFERENT from the run's, we instantiate that provider (resolveProvider); otherwise we
 * reuse the run's provider instance (zero behavior change for the default path).
 */
function resolveRoleRuntime(
  role: ModelRoleId,
  runProvider: Provider,
  command: { model_id: string; model_overrides?: Partial<Record<ModelRoleId, ModelRoleOverride>>; model_role_env?: Record<string, string | undefined> },
): { provider: Provider; model_id: string } {
  const resolved = resolveModelForRole(role, {
    fallbackProviderId: runProvider.provider_id,
    fallbackModel: command.model_id,
    ...(command.model_overrides === undefined ? {} : { overrides: command.model_overrides }),
    env: command.model_role_env ?? process.env,
  })
  // Reuse the run's provider unless a role pins a genuinely DIFFERENT provider_id (the "different
  // model" hook the judgment spec left as a TODO — now real).
  const provider =
    resolved.provider_id === runProvider.provider_id
      ? runProvider
      : resolveProvider({ provider_id: resolved.provider_id as Parameters<typeof resolveProvider>[0]['provider_id'] })
  return { provider, model_id: resolved.model }
}

// ---------------------------------------------------------------------------
// model-tiering-spec — Dual-Model Cross-Check (moat class + Shariah sector status ONLY)
// ---------------------------------------------------------------------------

/**
 * Resolve a cross-check role to a runtime IFF it pins a DISTINCT provider/model from the run's active
 * one. Returns undefined when the role inherits the run's model (the default — cross-check OFF). This is
 * the registry-driven trigger: configuring a distinct provider/model on `lane_moat_crosscheck` /
 * `lane_shariah_crosscheck` (override or env) turns the cross-check ON for that classification only.
 */
function resolveCrossCheckRuntime(
  role: 'lane_moat_crosscheck' | 'lane_shariah_crosscheck',
  runProvider: Provider,
  command: { model_id: string; model_overrides?: Partial<Record<ModelRoleId, ModelRoleOverride>>; model_role_env?: Record<string, string | undefined> },
): { provider: Provider; model_id: string } | undefined {
  const resolved = resolveModelForRole(role, {
    fallbackProviderId: runProvider.provider_id,
    fallbackModel: command.model_id,
    ...(command.model_overrides === undefined ? {} : { overrides: command.model_overrides }),
    env: command.model_role_env ?? process.env,
  })
  // Distinct = a different provider OR a different model than the run's active one.
  const distinct = resolved.provider_id !== runProvider.provider_id || resolved.model !== command.model_id
  if (!distinct) return undefined
  const provider =
    resolved.provider_id === runProvider.provider_id
      ? runProvider
      : resolveProvider({ provider_id: resolved.provider_id as Parameters<typeof resolveProvider>[0]['provider_id'] })
  return { provider, model_id: resolved.model }
}

// ---------------------------------------------------------------------------
// SEC EDGAR primary-filing grounding (fail-closed, test-mode-gated)
// ---------------------------------------------------------------------------

/**
 * Dependency surface for pre-fetching SEC EDGAR fundamentals. Lets the web layer inject a fixture (so
 * e2e stays deterministic + offline) or override the fetcher. When neither is provided AND the run is
 * in playwright test mode, the swarm does NOT hit SEC live — it proceeds with no fundamentals (exactly
 * as today). Outside test mode with no override, the live adapter is used.
 */
export type FundamentalsDeps = {
  /** Pre-resolved fundamentals (e.g. an e2e/test fixture). Takes precedence over fetchFundamentals. */
  fundamentals?: Fundamentals
  /** Override fetcher. Defaults to the live SEC EDGAR adapter outside playwright test mode. */
  fetchFundamentals?: (ticker: string, deps?: SecEdgarDeps) => Promise<Fundamentals | undefined>
  /**
   * Override the current-price resolver (e.g. an e2e/test fixture). Used with EDGAR diluted shares to
   * derive market cap for the AAOIFI debt/cash ratios. Defaults to the live Yahoo adapter outside
   * playwright test mode; fail-closed + test-mode-gated exactly like fetchFundamentals.
   */
  resolvePrice?: (ticker: string, deps?: MarketDataDeps) => Promise<PriceQuote>
  /**
   * Override the trailing 36-month average-market-cap resolver (e.g. an e2e/test fixture). Used for
   * the Shariah debt/cash ratios (the spec's "36-mo avg"). Defaults to the live Yahoo monthly-history
   * adapter outside playwright test mode; fail-closed + test-mode-gated like the other resolvers.
   * `diluted_shares` is in MILLIONS (so the returned market_cap is in $MILLIONS).
   */
  resolveAverageMarketCap?: (
    ticker: string,
    diluted_shares: number,
    deps?: MarketDataDeps,
  ) => Promise<AverageMarketCapResult>
  /**
   * Pre-resolved insider-transaction summary (§3.3). Takes precedence over the live Form 4 fetch; tests
   * inject this directly so the management-lane insider block is deterministic without touching the network.
   */
  insiderSummary?: InsiderSummary
  /**
   * Override the per-document Form 4 fetch (tests inject fixtures). Used only on the live path when
   * `insiderSummary` is absent and the run is not in offline test mode.
   */
  fetchForm4Document?: (url: string) => Promise<string | undefined>
  /**
   * S5: pre-resolved retained-earnings test result (tests inject; e2e fixtures). Takes precedence over
   * the live price-history fetch. Absent + offline test mode → the test is simply not computed.
   */
  retainedEarnings?: RetainedEarningsTestResult
  /**
   * Override the FX-rate resolver (currency → USD multiplier) for test injection. Used in the Shariah
   * block to convert a USD market cap into the filer's reporting currency for foreign filers (IFRS/20-F).
   * Defaults to the live Yahoo FX fetch outside offline test mode; fail-closed: undefined → not-computable.
   * Only called when `la.currency !== market_cap_currency` (i.e., the filer reports in a non-USD currency
   * while market_cap is quoted in USD — the ADR case). USD-filer runs never call it.
   */
  resolveFxRate?: (currency: string) => Promise<number | undefined>
  // F.2 (SHIPPED): the discount risk-free anchor is the COMPLIANT app-config savings rate threaded into the
  // deep-dive command (`risk_free_rate`), NOT a live Treasury fetch. The former `resolveTreasuryYield`
  // override + `resolveTreasuryYieldValue` helper were retired here, and the now-dead marketData Treasury
  // fetch/exports have since been removed entirely.
}

/**
 * True when we must NOT hit live external data feeds (SEC EDGAR, Yahoo): playwright e2e mode and
 * vitest unit runs. Tests that want EDGAR-anchored behavior inject `fundamentals`/`resolvePrice`
 * explicitly; tests that omit them get TODAY's offline behavior deterministically.
 */
function isOfflineTestMode(): boolean {
  return process.env['OWLFOLIO_TEST_MODE'] === 'playwright' || process.env['VITEST'] !== undefined
}

/**
 * Annual-report forms the quick-screen pre-fetch accepts as the primary filing: 10-K (US), 20-F (foreign
 * private issuers such as TSMC), 40-F (Canadian issuers). Selecting ACROSS these three forms — NOT 10-K
 * only — is what lets an FPI like TSMC (a 20-F filer, the ticker that surfaced this grounding bug) ground.
 * `Fundamentals.filings` is already filtered to exactly these forms and sorted newest-first, so the first
 * match is the latest annual filing. (The deep-dive's existing 10-K-only `.find` is intentionally left
 * unchanged in this slice — see the note at its call site.)
 */
const QUICK_SCREEN_ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F'])

/**
 * Resolve fundamentals for a ticker, fail-closed and test-mode-gated. Never throws — any error yields
 * undefined so the swarm runs exactly as today (no regression when EDGAR is down / ticker is non-US).
 */
async function resolveFundamentals(ticker: string, deps: FundamentalsDeps): Promise<Fundamentals | undefined> {
  try {
    if (deps.fundamentals !== undefined) return deps.fundamentals
    if (deps.fetchFundamentals !== undefined) return await deps.fetchFundamentals(ticker)
    // No injection: in offline test mode, do NOT hit SEC live (offline/deterministic tests). The
    // local-manual store is also skipped offline so unit tests stay hermetic (they inject explicitly).
    if (isOfflineTestMode()) return undefined
    // Resolve through the pluggable provider chain: local-manual store (operator override, covers
    // non-EDGAR GCC names) -> EDGAR (us-gaap/USD + ifrs-full/non-USD, 10-K/20-F/40-F) -> undefined.
    return await resolveFundamentalsForTicker(ticker)
  } catch {
    return undefined
  }
}

/** Small backoff between the live-data fetch attempt and its single retry (skipped in offline tests). */
const PRICE_FETCH_RETRY_BACKOFF_MS = 250

/** Await a short backoff before the retry — skipped under offline test mode so unit tests stay fast. */
async function priceRetryBackoff(): Promise<void> {
  if (isOfflineTestMode()) return
  await new Promise((resolve) => setTimeout(resolve, PRICE_FETCH_RETRY_BACKOFF_MS))
}

/**
 * Resolve a current price for a ticker, fail-closed and test-mode-gated (mirrors resolveFundamentals).
 * A TRANSIENT failure (a thrown error, or an unavailable quote — the live Yahoo path returns
 * available:false on a fetch error) gets ONE retry with a small backoff before giving up, so a momentary
 * blip mid-run no longer silently voids the market cap (the live dogfood failure). Still fail-closed:
 * returns undefined after the retry so the AAOIFI debt/cash ratios degrade rather than emit a bogus cap.
 */
async function resolveCurrentPriceValue(ticker: string, deps: FundamentalsDeps): Promise<number | undefined> {
  const resolver = deps.resolvePrice
    ?? (isOfflineTestMode()
      ? undefined
      : ((t: string, d?: MarketDataDeps) => resolveCurrentPrice({ ticker: t }, d)))
  if (resolver === undefined) return undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await priceRetryBackoff()
    try {
      const quote = await resolver(ticker)
      if (quote.available) return quote.price_per_share
      // available:false — transient (live path fails closed this way); retry once, then give up.
    } catch {
      // Thrown transient error — retry once, then give up (fail-closed).
    }
  }
  return undefined
}

/**
 * Resolve the trailing 36-month AVERAGE market cap ($MILLIONS) for a ticker, fail-closed and
 * test-mode-gated (mirrors resolveCurrentPriceValue, including the single transient-failure retry).
 * Returns undefined after the retry so the Shariah ratios degrade to the CURRENT-price market cap.
 * `diluted_shares` is in MILLIONS so the returned market cap is in $MILLIONS (AAOIFI ratio inputs).
 */
async function resolveAverageMarketCapValue(
  ticker: string,
  diluted_shares: number,
  deps: FundamentalsDeps,
): Promise<{ market_cap: number; months: number; currency: string } | undefined> {
  const resolver = deps.resolveAverageMarketCap
    ?? (isOfflineTestMode()
      ? undefined
      : ((t: string, shares: number, d?: MarketDataDeps) => fetchAverageMarketCap({ ticker: t }, shares, undefined, d)))
  if (resolver === undefined) return undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await priceRetryBackoff()
    try {
      const result = await resolver(ticker, diluted_shares)
      if (result.available) return { market_cap: result.market_cap, months: result.months, currency: result.currency }
      // available:false — transient; retry once, then give up.
    } catch {
      // Thrown transient error — retry once, then give up.
    }
  }
  return undefined
}

/**
 * Resolve the FX rate for `currency` → USD, fail-closed and test-mode-gated. Returns 1 for USD (passthrough),
 * undefined on any failure so the Shariah block can fail closed (UNDETERMINED) rather than mixing currencies.
 * Tests inject `deps.resolveFxRate`; in offline test mode without an override this returns undefined (fail-closed).
 */
async function resolveFxRateValue(currency: string, deps: FundamentalsDeps): Promise<number | undefined> {
  const resolver = deps.resolveFxRate
    ?? (isOfflineTestMode()
      ? undefined
      : ((c: string) => fetchFxRateToUsd(c)))
  if (resolver === undefined) return undefined
  try {
    return await resolver(currency)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Helpers for mapping shariah status
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runStrategyResearchSwarm(
  store: SwarmStore,
  provider: Provider,
  command: RunStrategyResearchSwarmCommand,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number; maxToolCalls?: number } & FundamentalsDeps = {},
) {
  // Engine-version provenance: stamp the run's reasoning vintage (and best-effort commit) at the event
  // payload ROOT so every emission site — including the early-exit reject/set-aside paths — carries it.
  const engineCommit = resolveEngineCommit()
  const accumulated = new Map<string, CapturedSource>()
  // Same-id guard (mergeCapturedIntoCorpus): a model re-proposal of an already-grounded id can never
  // clobber the verified capture — see the live browse-edgar dogfood bug documented on the helper.
  const remember = (captured: CapturedSource[]) => mergeCapturedIntoCorpus(accumulated, captured)

  // ---- Create research case ----
  const researchCase = await createResearchCase(store, {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    strategy_id: command.strategy_id,
    ...(command.strategy_version === undefined ? {} : { strategy_version: command.strategy_version }),
    actor_id: command.actor_id,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
    ...(command.version === undefined ? {} : { version: command.version }),
    ...(command.supersedes_research_case_id === undefined ? {} : { supersedes_research_case_id: command.supersedes_research_case_id }),
  })

  // ---- Pre-fetch + ground the primary filing for the front Shariah gate ----
  // The harness deterministically pre-fetches the latest ANNUAL filing and grounds it as a verified
  // primary source BEFORE any model spend — the front gate's reasoning pass is seeded with it (via
  // preVerifiedSourceIds + readCorpus), which is what grounds the sector judgment on a no-tools
  // provider (the production path). When fundamentals do NOT resolve (non-EDGAR name / EDGAR down)
  // the gate proceeds VISIBLY undetermined (gate_incomplete); the circle gate downstream still fails
  // closed to outside-competence when nothing verifiable grounds its clauses.
  const qsFundamentals = await resolveFundamentals(command.ticker, deps)
  let qsPrimaryFilingSourceId: string | undefined
  if (qsFundamentals !== undefined) {
    // Select the latest ANNUAL filing ACROSS 10-K / 20-F / 40-F (NOT 10-K-only — TSMC files a 20-F).
    // `filings` is already filtered to these forms and sorted newest-first, so the first match is latest.
    const annual = qsFundamentals.filings.find((x) => QUICK_SCREEN_ANNUAL_FORMS.has(x.form))
    if (annual !== undefined) {
      const formSlug = annual.form.toLowerCase().replace(/[^a-z0-9]/g, '')
      const sourceId = `sec_edgar_${formSlug}_${qsFundamentals.cik}_fy${qsFundamentals.latest_annual.fiscal_year}`
      const proposed: ProposedSource = {
        source_id: sourceId,
        title: `${qsFundamentals.entity_name} ${annual.form} (FY${qsFundamentals.latest_annual.fiscal_year}) — SEC EDGAR`,
        url: annual.url,
        excerpt: `Primary SEC EDGAR ${annual.form} filing for ${qsFundamentals.entity_name} (CIK ${qsFundamentals.cik}), filed ${annual.filed}.`,
      }
      // Ground the filing through the SAME path as model-proposed sources (content-hash + SSRF guard).
      const ground = deps.ground ?? groundProposedSources
      const grounded = await ground([proposed], deps.grounding)
      const captured = grounded.captured[0]
      if (captured !== undefined && grounded.verified_ids.includes(sourceId)) {
        remember([captured]) // part of the verified corpus from this point on
        qsPrimaryFilingSourceId = sourceId
      }
    }
  }

  // ---- The FRONT Shariah gate (gate #1) ----
  // The grounded sector judgment runs BEFORE any further model spend: the reasoning pass moved
  // forward, seeded with the harness-grounded primary filing (no lanes exist yet, so laneDigest is
  // empty). A NON-COMPLIANT sector (or, when computable this early, an AAOIFI ratio FAIL) sets the
  // case aside with a coherent PASS dossier; a pass outage proceeds VISIBLY undetermined
  // (gate_incomplete) — the downstream Shariah machinery still fails closed. The circle gate (gate #2,
  // inside the deep-dive phase, pre-lane) absorbs the retired quick screen's "worth a deep dive"
  // judgment — "durably predictable" is the stricter form of it.
  const shariahGateRuntime = resolveRoleRuntime('lane_shariah', provider, command)
  const shariahGate = await runShariahGatePhase(store, {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    model_id: shariahGateRuntime.model_id,
    causation_event_id: researchCase.event_id,
    // Powers the gate's deterministic entity-mention guard (wrong-company narrative → gate_incomplete).
    ...(qsFundamentals?.entity_name === undefined ? {} : { entity_name: qsFundamentals.entity_name }),
  }, {
    reasoningPass: () => runShariahReasoningPass(
      shariahGateRuntime.provider,
      {
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        model_id: shariahGateRuntime.model_id,
        laneDigest: [],
        corpusSourceIds: [...accumulated.values()].map((c) => c.source_id),
        preVerifiedSourceIds: qsPrimaryFilingSourceId !== undefined ? [qsPrimaryFilingSourceId] : [],
        ...(qsFundamentals?.latest_annual?.impermissible_income_lines === undefined
          ? {}
          : { impermissibleIncomeLines: qsFundamentals.latest_annual.impermissible_income_lines }),
      },
      {
        ...(deps.ground === undefined ? {} : { ground: deps.ground }),
        ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
        readCorpus: accumulated,
      },
    ),
    corpusSourceIds: [...accumulated.values()].map((c) => c.source_id),
  })
  // Corpus continuity: fold the gate pass's grounded captures into the run corpus so its verified
  // citations stay readable/citable by the circle gate, the lanes, and the cross-stage cite-checks.
  if (shariahGate.pass_captured !== undefined) {
    remember(shariahGate.pass_captured)
  }

  if (!shariahGate.allowed) {
    const rejectionReason = `Set aside at the Shariah gate: ${shariahGate.reason}`
    const gatePayload = shariahGate.event.payload as Record<string, unknown>
    const gateSetAsideAnalysisEvent: LedgerEventEnvelope<unknown> = {
      event_id: `evt_buffett_munger_analysis_drafted_${command.research_case_id}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case',
      aggregate_id: command.research_case_id,
      correlation_id: command.research_case_id,
      causation_id: shariahGate.event_id,
      actor_type: 'provider',
      actor_id: provider.provider_id,
      payload: {
        research_case_id: command.research_case_id,
        company_id: command.company_id,
        ticker: command.ticker,
        engine_version: ENGINE_VERSION,
        ...(engineCommit === undefined ? {} : { engine_commit: engineCommit }),
        investment_verdict: 'PASS',
        strategy_compliance: 'NON_COMPLIANT',
        shariah_status: 'NON_COMPLIANT',
        valuation_status: 'INSUFFICIENT_DATA',
        next_required_action: 'No further research required; case set aside at the Shariah gate.',
        shariah_gate: {
          sector_status: gatePayload['sector_status'],
          ...(gatePayload['sector_reasoning'] === undefined ? {} : { sector_reasoning: gatePayload['sector_reasoning'] }),
          ...(gatePayload['impermissible_income'] === undefined ? {} : { impermissible_income: gatePayload['impermissible_income'] }),
          ...(gatePayload['ratio_verdict'] === undefined ? {} : { ratio_verdict: gatePayload['ratio_verdict'] }),
          reason: shariahGate.reason,
        },
      },
      source_ids: shariahGate.event.source_ids,
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `analysis:${command.research_case_id}:v1`,
    }
    const gateSetAsideAnalysis = await store.append(gateSetAsideAnalysisEvent)

    const gateSetAsideDecision = await draftDecision(store, {
      research_case_id: command.research_case_id,
      decision_id: command.decision_id,
      decision: 'PASS',
      reason: rejectionReason,
      thesis_summary: rejectionReason,
      evidence_summary: rejectionReason,
      valuation_rationale: 'Not assessed — case set aside at the Shariah gate before the deep dive.',
      shariah_rationale: shariahGate.reason,
      risks: [],
      open_questions: [],
      causation_id: shariahGate.event_id,
      source_ids: shariahGate.event.source_ids,
      idempotency_key: `decision:${command.research_case_id}:v1`,
    })

    const capturedSoFar = [...accumulated.values()]
    if (capturedSoFar.length > 0) {
      await ingestManualSourceBundle({
        source_ledger_path: command.source_ledger_path,
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        strategy_id: command.strategy_id,
        provider_id: provider.provider_id,
        proposed_by_actor_type: 'provider',
        proposed_by_actor_id: provider.provider_id,
        ingested_by_actor_type: 'system',
        ingested_by_actor_id: 'research_workflow',
        sources: toLedgerSourceInputs(capturedSoFar, command.research_case_id),
      })
    }

    return {
      research_case: researchCase,
      shariah_gate: shariahGate.event,
      analysis: gateSetAsideAnalysis,
      decision: gateSetAsideDecision,
    }
  }

  // Sources verified at the front gate: the harness-grounded primary filing + the gate's verified
  // sector citation. These seed the deep-dive phase (queueDeepDive source_ids + the circle/queue
  // causation chain) exactly as the retired quick screen's verified set used to.
  const gateSourceIds = [...new Set([
    ...(qsPrimaryFilingSourceId !== undefined ? [qsPrimaryFilingSourceId] : []),
    ...shariahGate.event.source_ids,
  ])]

  // ---- Run the deep-dive phase (the approval pause now lives INSIDE it, behind the circle gate) ----
  const deepDiveResult = await runResearchDeepDivePhase(store, provider, {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    strategy_id: command.strategy_id,
    ...(command.strategy_version === undefined ? {} : { strategy_version: command.strategy_version }),
    model_id: command.model_id,
    decision_id: command.decision_id,
    source_ledger_path: command.source_ledger_path,
    gate_source_ids: gateSourceIds,
    gate_event_id: shariahGate.event_id,
    // model-tiering: forward per-role overrides so the deep-dive lanes + dual-model cross-check honor them.
    ...(command.model_overrides === undefined ? {} : { model_overrides: command.model_overrides }),
    // Forward the env source so file-configured tiers take effect in the deep-dive phase too.
    ...(command.model_role_env === undefined ? {} : { model_role_env: command.model_role_env }),
    // Forward the circle-gate hardening knobs (k-sample agreement + evidence floors).
    ...(command.circle_gate === undefined ? {} : { circle_gate: command.circle_gate }),
    // F.2: forward the compliant savings anchor so automatic-mode valuations use the SAME discount
    // as approval-resume ones (previously only the resume path threaded it).
    ...(command.risk_free_rate === undefined ? {} : { risk_free_rate: command.risk_free_rate }),
    ...(command.required_return === undefined ? {} : { required_return: command.required_return }),
    // S3: the deep-dive approval pause is applied INSIDE the phase, AFTER both cheap gates pass and
    // BEFORE any lane spend. The approval-resume path calls the phase without this key (automatic).
    ...(command.deep_dive_approval === undefined ? {} : { deep_dive_approval: command.deep_dive_approval }),
    // S6: forward the user-authored moat-gate override (run remaining pillars anyway).
    ...(command.moat_gate_override === undefined ? {} : { moat_gate_override: command.moat_gate_override }),
  }, { ...deps, accumulated })

  return {
    research_case: researchCase,
    shariah_gate: shariahGate.event,
    ...deepDiveResult,
  }
}

// ---------------------------------------------------------------------------
// Deep-dive phase (extracted so it can be called independently)
// ---------------------------------------------------------------------------

// The model's judged maintenance capex is flagged (ADVISORY) when it sits MATERIALLY below the conservative
// Greenwald/D&A proxy — i.e. more than this fraction below it (more aggressive OE → higher value). The flag
// NEVER blocks the verdict; it directs the human to verify the basis.

/**
 * Run the CIRCLE-OF-COMPETENCE judgment as a grounded model call (the SAME grounded-agent path the lanes
 * use — runGroundedAgentWithTools with tool/citation grounding, so it produces proposed_sources +
 * verified_ids and content-hash-confirmed captured sources the harness cite-verifies). It is the model's
 * demonstration of whether it understands THIS business well enough to assess its cashflow predictability.
 * The caller cite-verifies BOTH clauses and fails closed to outside-competence when either is ungrounded.
 */
async function judgeCircleCompetence(
  provider: Provider,
  command: RunResearchDeepDivePhaseCommand,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; maxToolCalls?: number; preVerifiedSourcesBlock?: string; readCorpus?: ReadonlyMap<string, CapturedSource> } & FundamentalsDeps,
  opts: { sampleIndex?: number; minDrivers?: number; minBreakers?: number } = {},
) {
  // The circle judgment runs on the synthesis role (T1 — the high-stakes judgment tier). Default = the
  // run's provider/model so single-provider runs are unchanged; an override can pin it onto a frontier model.
  const circleRuntime = resolveRoleRuntime('synthesis', provider, command)
  // Evidence-floor gather instruction: tell the model how many cited clauses the harness requires so a
  // thin gather is a MODEL shortfall, not a moving harness target.
  const floorNote = opts.minDrivers !== undefined && opts.minBreakers !== undefined
    ? ` Provide at least ${opts.minDrivers} distinct cited cashflow_drivers and at least ${opts.minBreakers} distinct cited predictability_breakers — fewer grounded clauses fails closed to outside-competence.`
    : ''
  const prompt = `You are the Buffett-Munger circle-of-competence gate for ${command.ticker} (${command.company_id}). `
    + CIRCLE_COMPETENCE_PROMPT
    + floorNote
    // citation/corpus-alignment: surface the harness's already-verified EDGAR primary source_id so the
    // cashflow_drivers / predictability_breakers cite an id that reliably verifies (the cite-check below
    // grounds on it) instead of the model's own flaky SEC-archive id.
    + (deps.preVerifiedSourcesBlock ?? '')
  // Sample 1 keeps the historical run_id; later agreement samples get a suffix so per-call run ids stay unique.
  const sampleSuffix = opts.sampleIndex !== undefined && opts.sampleIndex > 0 ? `_s${opts.sampleIndex + 1}` : ''
  const { degraded_no_tools: _circleDegraded, ...agent } = await runGroundedAgentWithTools(
    circleRuntime.provider,
    {
      run_id: `run_${command.research_case_id}_circle_competence${sampleSuffix}`,
      model_id: circleRuntime.model_id,
      prompt,
      timeout_ms: AGENT_TIMEOUT_MS,
      schema_name: 'BuffettMungerCircleCompetence',
    },
    CircleCompetenceSchema,
    {
      ...(deps.ground === undefined ? {} : { ground: deps.ground }),
      ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
      ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
      ...(deps.maxToolCalls === undefined ? {} : { maxToolCalls: deps.maxToolCalls }),
      ...(deps.readCorpus === undefined ? {} : { readCorpus: deps.readCorpus }),
    },
  )
  void _circleDegraded
  return agent
}

/** Max recent 8-K/10-Q filings grounded as readable interim-recency documents (Slice B). */
const RECENT_READABLE_MAX = 6
/** Lanes that receive the recent-interim-filings affordance — the QUALITATIVE lanes only (the numeric
 * lanes are deliberately excluded so interim 10-Q numbers never tempt the valuation/Shariah recompute). */
const RECENT_FILINGS_LANES = new Set<string>(['understand', 'moat', 'management'])

/** Lanes that receive the LATEST PROXY STATEMENT affordance (3.1): management (incentives/comp —
 * primary) + moat (dual-class/entrenchment/governance — owner-approved SOURCE_POLICY v2 widening).
 * The numeric lanes are deliberately excluded; risks can already cite anything but has no comp mandate. */
const PROXY_LANES = new Set<string>(['management', 'moat'])

/** Lanes that receive the INSIDER TRANSACTIONS (Form 4) affordance (§3.3): MANAGEMENT only — insider
 * buying/selling is a management-quality / capital-allocation signal. Deterministically parsed by the
 * harness (secForm4.ts); mechanical RSU/tax activity is excluded from the discretionary figures. */
const INSIDER_LANES = new Set<string>(['management'])

/**
 * S6 (Phase 3, owner-locked): the EARLY MOAT-GATE short-circuit. A below-gate Pillar 2 ends the run
 * HERE — Pillars 1–2 findings are recorded, a terminal analysis + decision is emitted, and the
 * management/valuation/red-team/synthesis provider spend NEVER happens (the stage-cost record proves
 * it). Mirrors the circle set-aside early-exit: a genuinely-narrow GROUNDED thesis is a set-aside
 * (PASS); an UNGROUNDED wide claim is incomplete research (RESEARCH_MORE). The dossier renders
 * Pillars 3–4 "not evaluated — failed at the moat filter" off moat_gate_short_circuited; the
 * user-authored override re-run (moat_gate_override) is the "run remaining pillars anyway" path.
 */
async function emitMoatGateShortCircuit(args: {
  store: SwarmStore
  provider: Provider
  command: RunResearchDeepDivePhaseCommand
  strategyRef: ReturnType<typeof resolveResearchStrategyRef>
  accumulated: Map<string, CapturedSource>
  engineCommit: string | undefined
  started: { deep_dive_id: string; event_id: string }
  stageAResults: LaneSwarmResult[]
  judgment: JudgmentResolution
  moatTests?: MoatTests
  circleJudgmentPayload?: unknown
  moatGrounded: boolean
}) {
  const { store, provider, command, strategyRef, accumulated, engineCommit, started, stageAResults, judgment } = args

  // Record the Pillar 1–2 findings (same contract as the full path — lanes with zero verified ids skip).
  for (const lane of stageAResults) {
    if (lane.verified_ids.length === 0) continue
    await recordSpecialistFinding(store, {
      research_case_id: command.research_case_id,
      finding_id: `finding_${swarmSeg(command.research_case_id)}_${swarmSeg(lane.lane)}`,
      deep_dive_id: started.deep_dive_id,
      ...strategyRef,
      specialist_lane: lane.lane,
      finding_summary: lane.finding_summary,
      confidence: lane.confidence,
      ...(lane.wall_ms === undefined ? {} : {
        stage_cost: {
          provider_calls: 1,
          ...(lane.usage?.input_tokens === undefined ? {} : { input_tokens: lane.usage.input_tokens }),
          ...(lane.usage?.output_tokens === undefined ? {} : { output_tokens: lane.usage.output_tokens }),
          wall_ms: lane.wall_ms,
        },
      }),
      caveats: lane.status === 'incomplete' ? [...lane.caveats, 'status:incomplete'] : lane.caveats,
      source_ids: lane.verified_ids,
      causation_id: started.event_id,
      actor_id: provider.provider_id,
      idempotency_key: `specialist-finding:${command.research_case_id}:${lane.lane}:v1`,
    })
  }

  const resolvedMoatClass = judgment.moat!.resolved_moat_class
  const verdict = args.moatGrounded ? ('PASS' as const) : ('RESEARCH_MORE' as const)
  const reason = args.moatGrounded
    ? `Moat below the wide-moat gate (${resolvedMoatClass}, grounded) — set aside at the moat filter; Pillars 3–4 were not evaluated.`
    : `Moat gate failed on an UNGROUNDED claim (the model reached for a gate-passing class the cite-verified drivers could not back; resolved '${resolvedMoatClass}') — research incomplete; Pillars 3–4 were not evaluated.`
  const verifiedIds = [...new Set(stageAResults.flatMap((l) => l.verified_ids))]
  const sourceIds = verifiedIds.length > 0 ? verifiedIds : command.gate_source_ids

  const judgmentProjection = buildJudgmentProjection(judgment)
  const analysisEvent: LedgerEventEnvelope<unknown> = {
    event_id: `evt_buffett_munger_analysis_drafted_${command.research_case_id}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    causation_id: started.event_id,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload: {
      research_case_id: command.research_case_id,
      company_id: command.company_id,
      ticker: command.ticker,
      engine_version: ENGINE_VERSION,
      ...(engineCommit === undefined ? {} : { engine_commit: engineCommit }),
      investment_verdict: verdict,
      strategy_compliance: 'INSUFFICIENT_DATA',
      valuation_status: 'INSUFFICIENT_DATA',
      next_required_action: args.moatGrounded
        ? 'No further research — failed at the moat filter (Pillar 2). "Run remaining pillars anyway" re-runs with the gate overridden.'
        : 'Re-run to ground the moat thesis — the gate failed on an ungrounded claim, not a demonstrated narrow moat.',
      // GATED-DOSSIER INVARIANT (owner): the pillar frame reads this flag — Pillars 3–4 render
      // "not evaluated — failed at the moat filter" (no numbers exist to quarantine: they never ran).
      moat_gate_short_circuited: true,
      ...(args.circleJudgmentPayload !== undefined ? { circle_competence: args.circleJudgmentPayload } : {}),
      ...(args.moatTests !== undefined ? { moat_tests: args.moatTests } : {}),
      // B3: Pillar 1 ran in Stage A — its one-pager renders even on a gated dossier.
      ...((() => {
        const op = stageAResults.find((l) => l.lane === 'understand')?.one_pager
        return op !== undefined ? { one_pager: op } : {}
      })()),
      valuation: {
        moat_class: resolvedMoatClass,
        moat_passes_gate: false,
        ...(args.moatGrounded ? {} : { moat_grounding_unmet: true }),
        ...(judgmentProjection !== undefined ? { judgment: judgmentProjection } : {}),
      },
    },
    source_ids: sourceIds,
    created_at: new Date().toISOString(),
    schema_version: 1,
    idempotency_key: `analysis:${command.research_case_id}:v1`,
  }
  const analysis = await store.append(analysisEvent)
  const decision = await draftDecision(store, {
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    decision: verdict,
    reason,
    thesis_summary: reason,
    evidence_summary: `Pillars 1–2 ran (${stageAResults.map((l) => l.lane).join(', ')}); the moat gate ended the run before Pillar 3–4 spend.`,
    valuation_rationale: 'Not assessed — the moat filter failed before the valuation pillar ran.',
    shariah_rationale: 'Front gate passed; the deep Shariah pass was not reached (moat filter).',
    risks: [reason],
    open_questions: [reason],
    causation_id: analysis.event_id,
    source_ids: sourceIds,
    idempotency_key: `decision:${command.research_case_id}:v1`,
  })

  const capturedSoFar = [...accumulated.values()]
  if (capturedSoFar.length > 0) {
    await ingestManualSourceBundle({
      source_ledger_path: command.source_ledger_path,
      research_case_id: command.research_case_id,
      ticker: command.ticker,
      strategy_id: command.strategy_id,
      provider_id: provider.provider_id,
      proposed_by_actor_type: 'provider',
      proposed_by_actor_id: provider.provider_id,
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'research_workflow',
      sources: toLedgerSourceInputs(capturedSoFar, command.research_case_id),
    })
  }

  return { analysis, decision, moat_gate_short_circuited: true as const, set_aside_outside_circle: undefined }
}

export async function runResearchDeepDivePhase(
  store: SwarmStore,
  provider: Provider,
  command: RunResearchDeepDivePhaseCommand,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number; maxToolCalls?: number; accumulated?: Map<string, CapturedSource> } & FundamentalsDeps = {},
) {
  const strategyRef = resolveResearchStrategyRef(command)
  const accumulated = deps.accumulated ?? new Map<string, CapturedSource>()
  // Same-id guard (mergeCapturedIntoCorpus): a model re-proposal of an already-grounded id can never
  // clobber the verified capture — see the live browse-edgar dogfood bug documented on the helper.
  const remember = (captured: CapturedSource[]) => mergeCapturedIntoCorpus(accumulated, captured)
  // Engine-version provenance stamped at the analysis payload ROOT — on BOTH the circle-gate set-aside
  // early-exit and the full deep-dive emission below (best-effort commit; omitted when unset).
  const engineCommit = resolveEngineCommit()

  const lanes = buffettMungerDeepDiveLanes

  // ---- Pre-fetch SEC EDGAR primary-filing fundamentals (fail-closed, test-mode-gated) ----
  // When fundamentals resolve, we ground the latest 10-K as a verified primary source and inject the
  // raw filing numbers into the financial_quality / moat lanes (PRIMARY_FILING_LANES) so those lanes
  // ground on filings instead of dropping when IR/news is blocked. When they do not resolve (non-US ticker,
  // EDGAR down, test mode w/o injection), the lanes run EXACTLY as today — no regression.
  //
  // citation/corpus-alignment fix (KO regression): this runs BEFORE the circle gate (not after, where it
  // used to) so the harness-verified EDGAR source_id is available to the circle gate, the moat lane, AND
  // the decision/synthesis agent as a PRE-VERIFIED-SOURCES block. KO spuriously resolved narrow because
  // the moat rows cited the model's OWN flaky SEC-archive id while the SAME 10-K was reliably verified
  // under the harness resolver id — the cited id was not in the verified set, so the rows scored 0. By
  // surfacing the resolver's already-content-hash-verified id and instructing the agents to cite THAT for
  // filing-backed claims, the model's citations align with what the harness reliably verifies. The strict
  // content-hash cite-check is unchanged — this only aligns WHAT is cited with what is VERIFIED.
  const fundamentals = await resolveFundamentals(command.ticker, deps)
  let primaryFilingBlock: string | undefined
  let primaryFilingSourceId: string | undefined
  if (fundamentals !== undefined) {
    // Latest PRIMARY ANNUAL across all annual forms (10-K US, 20-F/40-F foreign — the TSMC/Novo case),
    // mirroring the quick-screen pre-fetch. The form-slug id keeps 10-K filers on the IDENTICAL
    // `sec_edgar_10k_…` id (zero persistence/test churn); 20-F/40-F filers get `20f`/`40f` ids.
    const annual = selectLatestAnnualFiling(fundamentals)
    if (annual !== undefined) {
      const formSlug = annual.form.toLowerCase().replace(/[^a-z0-9]/g, '')
      const sourceId = `sec_edgar_${formSlug}_${fundamentals.cik}_fy${fundamentals.latest_annual.fiscal_year}`
      const proposed: ProposedSource = {
        source_id: sourceId,
        title: `${fundamentals.entity_name} ${annual.form} (FY${fundamentals.latest_annual.fiscal_year}) — SEC EDGAR`,
        url: annual.url,
        excerpt: `Primary SEC EDGAR ${annual.form} filing for ${fundamentals.entity_name} (CIK ${fundamentals.cik}), filed ${annual.filed}.`,
      }
      // Ground the annual filing through the same path as model-proposed sources (content-hash + SSRF guard).
      const ground = deps.ground ?? groundProposedSources
      const grounded = await ground([proposed], deps.grounding)
      const captured = grounded.captured[0]
      if (captured !== undefined && grounded.verified_ids.includes(sourceId)) {
        // Stamp filed/form so the ledger record carries the document's provenance (Axis B metadata).
        remember([{ ...captured, filed: annual.filed, form: annual.form }])
        primaryFilingSourceId = sourceId
        primaryFilingBlock = buildPrimaryFilingBlock(fundamentals, sourceId, annual.form)
      }
    }
  }
  // ---- Slice B: ground recent 8-K / 10-Q NARRATIVE as readable documents (interim recency) ----
  // Mirrors the 10-K grounding: fetch + sha256 + ledger via the SAME path, remembered into `accumulated`
  // so the qualitative lanes can READ them by Item via read_source. NUMBERS are never parsed here (the
  // annual-only recompute is untouched). Fail-closed: anything that does not ground is simply absent and
  // the lanes run on the annual floor as today.
  let recentFilingsBlock: string | undefined
  if (fundamentals !== undefined) {
    const recent = selectRecentReadableFilings(fundamentals, { max: RECENT_READABLE_MAX })
    if (recent.length > 0) {
      const ground = deps.ground ?? groundProposedSources
      const proposed: ProposedSource[] = recent.map((file, i) => ({
        source_id: `sec_edgar_recent_${fundamentals.cik}_${i}_${file.filed}`,
        title: `${fundamentals.entity_name} ${file.form} filed ${file.filed} — SEC EDGAR`,
        url: file.url,
        excerpt: `${file.form} interim filing for ${fundamentals.entity_name}, filed ${file.filed}.`,
      }))
      const grounded = await ground(proposed, deps.grounding)
      const verifiedSet = new Set(grounded.verified_ids)
      const verifiedRecent = recent
        .map((file, i) => ({ file, source_id: proposed[i]!.source_id }))
        .filter((x) => verifiedSet.has(x.source_id))
      if (verifiedRecent.length > 0) {
        // Stamp filed/form per capture so the ledger records carry document provenance (Axis B metadata).
        const byId = new Map(verifiedRecent.map((x) => [x.source_id, x.file]))
        remember(grounded.captured
          .filter((c) => verifiedSet.has(c.source_id))
          .map((c) => {
            const file = byId.get(c.source_id)
            return file === undefined ? c : { ...c, filed: file.filed, form: file.form }
          }))
        recentFilingsBlock = buildRecentFilingsBlock(
          verifiedRecent.map((x) => ({ source_id: x.source_id, form: x.file.form, filed: x.file.filed })),
        )
      }
    }
  }

  // ---- 3.1: ground the LATEST DEF 14A proxy as a readable document (management + moat) ----
  // The proxy is where incentive structure lives (comp linkage, insider ownership, governance,
  // related-party). Read as TEXT for qualitative judgment — comp tables are never parsed into figures.
  // The category is STAMPED 'proxy' at grounding because a real DEF 14A primaryDocument filename
  // (e.g. cost-20251204.htm) carries no URL signal for the classifier; the stamp drives the lane gate
  // (management + moat admit 'proxy' per SOURCE_POLICY v2; the numeric lanes reject it). Fail-closed:
  // an ungrounded proxy is simply absent and the lanes run as today.
  let proxyBlock: string | undefined
  if (fundamentals !== undefined) {
    const proxy = selectLatestProxyFiling(fundamentals)
    if (proxy !== undefined) {
      const ground = deps.ground ?? groundProposedSources
      const proxySourceId = `sec_edgar_def14a_${fundamentals.cik}_${proxy.filed}`
      const proposed: ProposedSource = {
        source_id: proxySourceId,
        title: `${fundamentals.entity_name} DEF 14A proxy statement filed ${proxy.filed} — SEC EDGAR`,
        url: proxy.url,
        excerpt: `Definitive annual proxy statement (DEF 14A) for ${fundamentals.entity_name}, filed ${proxy.filed}.`,
      }
      const grounded = await ground([proposed], deps.grounding)
      const captured = grounded.captured[0]
      if (captured !== undefined && grounded.verified_ids.includes(proxySourceId)) {
        remember([{ ...captured, source_category: 'proxy' as const, filed: proxy.filed, form: proxy.form }])
        proxyBlock = buildProxyBlock({ source_id: proxySourceId, filed: proxy.filed })
      }
    }
  }

  // ---- 3.3: INSIDER TRANSACTIONS (Form 4) — deterministic summary for the MANAGEMENT lane ----
  // The harness fetches + parses the recent Form 4 documents (secForm4.ts) from the submissions Form 4
  // list, ONLY in the deep dive so the ~cap-40 per-document fetch cost never burdens the quick screen.
  // Discretionary open-market (P/S) trades are the management-quality signal; mechanical RSU/option/tax
  // activity is surfaced separately and NEVER counted as insider selling. Fail-closed + test-mode-gated
  // exactly like the proxy/interim affordances: an uncomputable summary is simply absent and the lane
  // runs as today. `insiderSummary` is also carried forward for the re-review cluster trigger.
  let insiderBlock: string | undefined
  let insiderSummaryComputed: InsiderSummaryComputed | undefined
  if (fundamentals !== undefined) {
    let summary: InsiderSummary | undefined = deps.insiderSummary
    if (summary === undefined && !isOfflineTestMode()) {
      const asOf = new Date().toISOString().slice(0, 10)
      summary = await resolveInsiderSummary(
        fundamentals.form4_filings ?? [],
        { asOf },
        deps.fetchForm4Document !== undefined ? { fetchDocument: deps.fetchForm4Document } : undefined,
      )
    }
    if (summary !== undefined && summary.computable) {
      insiderSummaryComputed = summary
      insiderBlock = buildInsiderBlock(summary)
    }
  }

  // ---- S2 (Phase 3): the owner's three NAMED moat tests, pure T0 over the EDGAR series ----
  // Capital efficiency (ROIC bands) / two-engine (revenue + margin trend) / standout (company-side
  // gross margin; the peer half is the moat lane's labeled judgment). Display/judgment context —
  // each test fails closed independently; the block never gates a verdict by itself. Omitted
  // entirely when no EDGAR series exists (nothing to compute over — never fabricated). Computed
  // BEFORE the lanes so the S6 early-gate short-circuit can carry it on the terminal dossier.
  const moatTests: MoatTests | undefined =
    fundamentals?.annual_series !== undefined && fundamentals.annual_series.length > 0
      ? computeMoatTests(fundamentals.annual_series)
      : undefined

  // ---- S5 (Phase 3): MANAGEMENT TALENT T0 + the retained-earnings test — the observation block ----
  // The owner's three talent criteria (ROIC / payout discipline / debt management) computed
  // deterministically from the EDGAR series, plus Buffett's retained-earnings test ($1 retained →
  // >=$1 of market value) from split-adjusted price history. Injected into the management lane as a
  // reconcile-contract block (like the insider block) and PERSISTED on the analysis payload. Each
  // piece fails closed independently; offline test mode never touches the network.
  let managementTalentT0: ManagementTalentT0 | undefined
  let retainedEarnings: RetainedEarningsTestResult | undefined
  let managementTalentBlock: string | undefined
  if (fundamentals?.annual_series !== undefined && fundamentals.annual_series.length > 0) {
    managementTalentT0 = computeManagementTalentT0(fundamentals.annual_series)
    if (deps.retainedEarnings !== undefined) {
      retainedEarnings = deps.retainedEarnings
    } else if (!isOfflineTestMode()) {
      retainedEarnings = await runRetainedEarningsTest(command.ticker, fundamentals.annual_series)
    }
    managementTalentBlock = `\n${buildManagementTalentBlock(managementTalentT0, retainedEarnings)}\n`
  }

  // The PRE-VERIFIED-SOURCES block lists the harness's already-content-hash-verified EDGAR primary
  // source_ids and instructs the agent to cite THOSE for filing-backed claims (instead of inventing its
  // own SEC archive URLs, which fetch unreliably). Surfaced to the circle gate, the moat lane, and the
  // decision/synthesis agent — the three lanes whose filing-backed claims drive the cite-check verdicts.
  const preVerifiedSourcesBlock = primaryFilingSourceId !== undefined
    ? buildPreVerifiedSourcesBlock([primaryFilingSourceId])
    : undefined

  // ---- CIRCLE-OF-COMPETENCE GATE (sequential pre-deep-dive stage — gates the 5-lane spend) ----
  // The circle of competence is a GROUNDED MODEL JUDGMENT, not a config screen: "do I understand THIS
  // business well enough to assess its cashflow predictability?" It runs as its OWN call (NOT an 8th
  // parallel lane) at the START of the deep-dive phase, BEFORE the expensive 5 lanes — the cheap quick
  // screen already ran. The model must DEMONSTRATE understanding: cite-verify BOTH the cashflow drivers
  // AND what would make them unpredictable, held to the SAME rigor. Binary outcome:
  //   - in-competence  → proceed to the 5-lane deep dive + synthesis + decision (today's path).
  //   - outside-competence (model says so, OR fail-closed on EITHER ungrounded clause) → SET ASIDE: emit a
  //     terminal decision with verdict PASS carrying competence_reasoning + the circle_competence_unmet
  //     flag; the 5 lanes do NOT run. NEVER RESEARCH_MORE — a valid, common, CORRECT Buffett output.
  // Gate knobs: command (caller-resolved config) clamped through the SHARED helpers — undefined falls
  // back to the shared defaults, so caller omission can never soften the gate below the default posture.
  const gateKSamples = clampCircleGateKSamples(command.circle_gate?.k_samples)
  const gateMinDrivers = clampCircleGateMinDrivers(command.circle_gate?.min_drivers)
  const gateMinBreakers = clampCircleGateMinBreakers(command.circle_gate?.min_breakers)

  // ---- S3 stage-resume: reuse a decisive circle judgment on the approval-resume path ----
  // The deep-dive approval pause (below) sits AFTER the circle gate, so an approved resume re-enters
  // this phase with the circle judgment ALREADY recorded. Re-sampling would re-spend provider calls
  // and could FLIP the judgment after the human approved the spend — the ledger event IS the
  // judgment, so reuse it. Only an in-competence event short-circuits (a set-aside case has a
  // terminal decision and is never resumed).
  const priorDecisiveCircle = (await store.list()).find(
    (e) => e.event_type === 'circle_competence_judged'
      && e.aggregate_id === command.research_case_id
      && (e.payload as Record<string, unknown>)['in_competence'] === true,
  )

  let circleJudgmentPayload: Record<string, unknown>
  let circleVerifiedIds: string[]
  if (priorDecisiveCircle !== undefined) {
    const { research_case_id: _rc, company_id: _co, ticker: _tk, ...reusedJudgment } =
      priorDecisiveCircle.payload as Record<string, unknown>
    circleJudgmentPayload = reusedJudgment
    circleVerifiedIds = [...priorDecisiveCircle.source_ids]
  } else {
  // ---- k-SAMPLE AGREEMENT (gate hardening) ----
  // The gate is sampled up to k times; the deep dive is entered only on a UNANIMOUS in-competence vote.
  // Motivation (live dogfood): a single sampled judgment flipped durable↔uncertain across same-model,
  // same-filings runs — one flip decided the whole 7-lane spend. Sampling FAIL-FAST: the first dissenting
  // sample decides set-aside and later samples are never spent. Every sample's captured sources are
  // remembered (mergeCapturedIntoCorpus makes same-id re-captures safe).
  type CircleSample = {
    analysis: (Awaited<ReturnType<typeof judgeCircleCompetence>>)['analysis']
    verified_ids: string[]
    groundedDrivers: { driver?: string; citation: string }[]
    groundedBreakers: { breaker?: string; citation: string }[]
    predictability: string
    inCompetence: boolean
    unmetReason?: string
  }
  const circleSamples: CircleSample[] = []
  // S5 cost stamping: the circle stage's wall time + summed reported tokens across its k samples.
  const circleStartedAt = Date.now()
  let circleInputTokens: number | undefined
  let circleOutputTokens: number | undefined
  for (let sampleIndex = 0; sampleIndex < gateKSamples; sampleIndex++) {
    const circle = await judgeCircleCompetence(provider, command, {
      ...deps,
      ...(preVerifiedSourcesBlock === undefined ? {} : { preVerifiedSourcesBlock }),
      // Let the circle gate READ the harness-grounded EDGAR 10-K by Item (already in `accumulated`).
      readCorpus: accumulated,
    }, { sampleIndex, minDrivers: gateMinDrivers, minBreakers: gateMinBreakers })
    remember(circle.captured)
    if (circle.usage?.input_tokens !== undefined) circleInputTokens = (circleInputTokens ?? 0) + circle.usage.input_tokens
    if (circle.usage?.output_tokens !== undefined) circleOutputTokens = (circleOutputTokens ?? 0) + circle.usage.output_tokens
    // Build the verified cite-check set from ONLY content_hash-confirmed sources (the SAME hardened
    // primitive the §2/A1/rubric cite-checks use) — recomputed per sample as the corpus grows.
    const circleVerified = new Set<string>()
    for (const s of accumulated.values()) {
      if (s.content_hash === undefined) continue
      circleVerified.add(s.content_hash)
      circleVerified.add(s.source_id)
    }
    // Bug A: a claim counts grounded ONLY when its TEXT is non-empty AND its citation cite-verifies. An
    // empty claim with a verified citation MUST NOT count (the MU run cleared N=M=1 on citations alone).
    const groundedDrivers = circle.analysis.understanding_drivers.filter(
      (d) => (d.driver?.trim().length ?? 0) > 0 && isCitationGrounded(d.citation, circleVerified),
    )
    const groundedBreakers = circle.analysis.key_moving_parts.filter(
      (b) => (b.breaker?.trim().length ?? 0) > 0 && isCitationGrounded(b.citation, circleVerified),
    )
    // C1: the gate keys off the business_understanding ENUM. A sample votes in-competence ONLY when the
    // model judged 'understood' AND both clauses meet the GROUNDED evidence floors (≥ min_drivers
    // grounded understanding mechanisms AND ≥ min_breakers grounded key moving parts).
    // 'not_understood' / 'uncertain' / a thin gather → fail-closed dissent. Cashflow durability is NOT
    // judged here — the moat pillar owns it (moats are what give companies durable cash).
    const predictability = circle.analysis.business_understanding
    const driversGrounded = groundedDrivers.length >= gateMinDrivers
    const breakersGrounded = groundedBreakers.length >= gateMinBreakers
    const inCompetence = predictability === 'understood' && driversGrounded && breakersGrounded
    const samplePrefix = gateKSamples > 1 ? `sample ${sampleIndex + 1}/${gateKSamples} dissented — ` : ''
    const unmetReason = inCompetence
      ? undefined
      : predictability !== 'understood'
        ? `circle_competence_unmet: ${samplePrefix}the model judged this business ${predictability === 'not_understood' ? 'NOT understood' : 'of UNCERTAIN comprehensibility'} `
          + '— it could not explain the core economic engine from the filings. A valid, common, correct '
          + 'Buffett output. Set aside.'
        : !driversGrounded
          ? `circle_competence_unmet: ${samplePrefix}the model judged the business understood but only `
            + `${groundedDrivers.length} grounded understanding mechanism(s) met the evidence floor of ${gateMinDrivers} — a thin or `
            + 'ungrounded gather is outside competence (fail-closed). Set aside.'
          : `circle_competence_unmet: ${samplePrefix}the model grounded the understanding mechanisms but only `
            + `${groundedBreakers.length} grounded key moving part(s) met the evidence floor of ${gateMinBreakers} — `
            + 'the second question is held to the same rigor (fail-closed). Set aside.'
    circleSamples.push({
      analysis: circle.analysis,
      verified_ids: circle.verified_ids,
      groundedDrivers,
      groundedBreakers,
      predictability,
      inCompetence,
      ...(unmetReason === undefined ? {} : { unmetReason }),
    })
    if (!inCompetence) break // fail-fast: one dissent decides; don't spend the remaining samples
  }

  const inCompetence = circleSamples.length === gateKSamples && circleSamples.every((s) => s.inCompetence)
  // The REPRESENTATIVE sample backs the top-level judgment payload: the dissenting sample when set aside
  // (its enum/evidence explain the outcome), else the first agreeing sample.
  const representative = circleSamples.find((s) => !s.inCompetence) ?? circleSamples[0]!
  const circle = { analysis: representative.analysis, verified_ids: representative.verified_ids }
  const groundedDrivers = representative.groundedDrivers
  const groundedBreakers = representative.groundedBreakers
  const predictability = representative.predictability
  const circleUnmetReason = representative.unmetReason
  // Cite-check set over the FINAL corpus (all samples' captures included) for the payload grounded flags.
  const circleVerified = new Set<string>()
  for (const s of accumulated.values()) {
    if (s.content_hash === undefined) continue
    circleVerified.add(s.content_hash)
    circleVerified.add(s.source_id)
  }

  // Project-ready circle judgment payload (the cited drivers + breakers + outcome + reasoning). The resolved
  // `in_competence` boolean is DERIVED (durably_predictable && grounded) and kept as the internal/legacy
  // proceed/set-aside signal; cashflow_predictability + model_claimed_predictability carry the enum.
  const freshCircleJudgmentPayload = {
    in_competence: inCompetence,
    // C1: the judgment is UNDERSTANDING (Pillar 1 IS the circle); legacy events carry the retired
    // cashflow_predictability keys and project two-era onto the same slots.
    business_understanding: predictability,
    model_claimed_understanding: predictability,
    competence_reasoning: circle.analysis.competence_reasoning,
    understanding_drivers: circle.analysis.understanding_drivers.map((d) => ({
      driver: d.driver ?? '',
      citation: d.citation,
      grounded: (d.driver?.trim().length ?? 0) > 0 && isCitationGrounded(d.citation, circleVerified),
    })),
    key_moving_parts: circle.analysis.key_moving_parts.map((b) => ({
      breaker: b.breaker ?? '',
      citation: b.citation,
      grounded: (b.breaker?.trim().length ?? 0) > 0 && isCitationGrounded(b.citation, circleVerified),
    })),
    // Gate-hardening visibility (additive): the knobs this run gated under + a per-sample summary, so a
    // set-aside names WHICH sample dissented and a flip across samples is auditable, never silent.
    gate_config: { k_samples: gateKSamples, min_drivers: gateMinDrivers, min_breakers: gateMinBreakers },
    gate_samples: circleSamples.map((s, i) => ({
      sample: i + 1,
      in_competence: s.inCompetence,
      model_claimed_understanding: s.predictability,
      grounded_drivers: s.groundedDrivers.length,
      grounded_breakers: s.groundedBreakers.length,
    })),
    ...(circleUnmetReason !== undefined ? { circle_competence_unmet: true, reason: circleUnmetReason } : {}),
  }

  // Emit the circle judgment event (causation = the front-gate event; this is the first deep-dive stage).
  const circleJudged = await store.append({
    event_id: `evt_circle_competence_judged_${command.research_case_id}`,
    event_type: 'circle_competence_judged',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    causation_id: command.gate_event_id,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload: {
      research_case_id: command.research_case_id,
      company_id: command.company_id,
      ticker: command.ticker,
      ...freshCircleJudgmentPayload,
      // S5 cost stamping: this stage's spend (k grounded samples) — scheduler unattended-spend data.
      stage_cost: {
        provider_calls: circleSamples.length,
        ...(circleInputTokens === undefined ? {} : { input_tokens: circleInputTokens }),
        ...(circleOutputTokens === undefined ? {} : { output_tokens: circleOutputTokens }),
        wall_ms: Date.now() - circleStartedAt,
      },
    },
    source_ids: [...new Set([...groundedDrivers.map((d) => d.citation), ...groundedBreakers.map((b) => b.citation), ...circle.verified_ids])],
    created_at: new Date().toISOString(),
    schema_version: 1,
    idempotency_key: `circle-competence:${command.research_case_id}:v1`,
  } satisfies LedgerEventEnvelope<unknown>)

  if (!inCompetence) {
    // ---- OUTSIDE COMPETENCE → SET ASIDE (terminal PASS) — the 5 lanes do NOT run ----
    const circleSourceIds = [...new Set([...command.gate_source_ids, ...circle.verified_ids])]
    const setAsideReason = `Set aside — outside the circle of competence. ${circle.analysis.competence_reasoning}`
    const analysisEvent: LedgerEventEnvelope<unknown> = {
      event_id: `evt_buffett_munger_analysis_drafted_${command.research_case_id}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case',
      aggregate_id: command.research_case_id,
      correlation_id: command.research_case_id,
      causation_id: circleJudged.event_id,
      actor_type: 'provider',
      actor_id: provider.provider_id,
      payload: {
        research_case_id: command.research_case_id,
        company_id: command.company_id,
        ticker: command.ticker,
        engine_version: ENGINE_VERSION,
        ...(engineCommit === undefined ? {} : { engine_commit: engineCommit }),
        investment_verdict: 'PASS',
        strategy_compliance: 'INSUFFICIENT_DATA',
        valuation_status: 'INSUFFICIENT_DATA',
        next_required_action: 'No further research — set aside (outside the circle of competence).',
        // Carry the circle judgment on the valuation block (the dossier reads circle_competence_unmet here)
        // AND as a first-class circle_competence field (projected legacy-tolerantly).
        valuation: { circle_competence_unmet: true, outside_circle: true },
        circle_competence: freshCircleJudgmentPayload,
      },
      source_ids: circleSourceIds,
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `analysis:${command.research_case_id}:v1`,
    }
    const setAsideAnalysis = await store.append(analysisEvent)
    const setAsideDecision = await draftDecision(store, {
      research_case_id: command.research_case_id,
      decision_id: command.decision_id,
      decision: 'PASS',
      reason: setAsideReason,
      thesis_summary: setAsideReason,
      evidence_summary: circleUnmetReason ?? setAsideReason,
      valuation_rationale: 'Not assessed — set aside outside the circle of competence (the expensive deep dive did not run).',
      shariah_rationale: 'Not assessed — set aside before the deep dive.',
      risks: ['Outside circle of competence — cashflow predictability could not be demonstrated from filings.'],
      open_questions: [circleUnmetReason ?? setAsideReason],
      causation_id: circleJudged.event_id,
      source_ids: circleSourceIds,
      idempotency_key: `decision:${command.research_case_id}:v1`,
    })

    // Persist the circle-stage captured sources so the dossier's citations resolve.
    const capturedSoFar = [...accumulated.values()]
    if (capturedSoFar.length > 0) {
      await ingestManualSourceBundle({
        source_ledger_path: command.source_ledger_path,
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        strategy_id: command.strategy_id,
        provider_id: provider.provider_id,
        proposed_by_actor_type: 'provider',
        proposed_by_actor_id: provider.provider_id,
        ingested_by_actor_type: 'system',
        ingested_by_actor_id: 'research_workflow',
        sources: toLedgerSourceInputs(capturedSoFar, command.research_case_id),
      })
    }

    return {
      circle_competence_judged: circleJudged,
      analysis: setAsideAnalysis,
      decision: setAsideDecision,
      set_aside_outside_circle: true,
    }
  }

  circleJudgmentPayload = freshCircleJudgmentPayload
  circleVerifiedIds = circle.verified_ids
  } // end fresh circle judgment (else branch of the stage-resume reuse)

  // Seed the queue/start events with the gate-verified sources UNIONED with the circle gate's
  // verified sources. The front gate can legitimately open with an empty verified set
  // (gate_incomplete — its pass failed but it must not block on its own outage); by this point the
  // circle gate has grounded its clauses, so the union satisfies the pipeline's ≥1-source contract.
  const deepDiveSeedSourceIds = [...new Set([...command.gate_source_ids, ...circleVerifiedIds])]

  // ---- S3: the deep-dive approval pause — BEHIND both cheap gates, BEFORE any lane spend ----
  // 'review' pauses here (deep_dive_approval_pending; the web approve action appends
  // deep_dive_run_requested and the resume re-enters this phase WITHOUT the key → proceeds, reusing
  // the recorded circle judgment above). The human approves the expensive 5-lane spend knowing the
  // name passed the Shariah gate AND the circle gate.
  if ((command.deep_dive_approval ?? 'automatic') === 'review') {
    const capturedSoFar = [...accumulated.values()]
    if (capturedSoFar.length > 0) {
      await ingestManualSourceBundle({
        source_ledger_path: command.source_ledger_path,
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        strategy_id: command.strategy_id,
        provider_id: provider.provider_id,
        proposed_by_actor_type: 'provider',
        proposed_by_actor_id: provider.provider_id,
        ingested_by_actor_type: 'system',
        ingested_by_actor_id: 'research_workflow',
        sources: toLedgerSourceInputs(capturedSoFar, command.research_case_id),
      })
    }

    const pendingEvent: LedgerEventEnvelope<unknown> = {
      event_id: `evt_deep_dive_approval_pending_${command.research_case_id}`,
      event_type: 'deep_dive_approval_pending',
      aggregate_type: 'research_case',
      aggregate_id: command.research_case_id,
      correlation_id: command.research_case_id,
      causation_id: command.gate_event_id,
      actor_type: 'system',
      actor_id: 'research_workflow',
      payload: {
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        company_id: command.company_id,
        gate_source_ids: deepDiveSeedSourceIds,
        gate_event_id: command.gate_event_id,
        decision_id: command.decision_id,
        source_ledger_path: command.source_ledger_path,
        strategy_id: command.strategy_id,
        model_id: command.model_id,
      },
      source_ids: deepDiveSeedSourceIds,
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `deep-dive-approval-pending:${command.research_case_id}:v1`,
    }
    await store.append(pendingEvent)

    return {
      awaiting_deep_dive_approval: true as const,
    }
  }

  const queued = await queueDeepDive(store, {
    research_case_id: command.research_case_id,
    queue_id: `queue_${swarmSeg(command.research_case_id)}`,
    ...strategyRef,
    source_ids: deepDiveSeedSourceIds,
    causation_id: command.gate_event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-queue:${command.research_case_id}:v1`,
  })

  const started = await startDeepDive(store, {
    research_case_id: command.research_case_id,
    deep_dive_id: `deep_${swarmSeg(command.research_case_id)}`,
    ...strategyRef,
    specialist_lanes: lanes,
    source_ids: deepDiveSeedSourceIds,
    causation_id: queued.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-start:${command.research_case_id}:v1`,
  })


  // ---- Per-lane runner (invoked in STAGES below — S6: the early moat gate sits between them) ----
  const runLaneFn = async (lane: string): Promise<LaneOutcome> => {
    const laneStartedAt = Date.now() // Phase 2 V5: per-lane stage-cost wall clock
    // Inject the grounded primary-filing block into the financial-heavy lanes so they have a
    // guaranteed primary citation + real numbers. The lane MUST cite the EDGAR source_id.
    // injectFiling governs the verified-id FORCE-ADD + captured-corpus seeding (so the resolver 10-K id is
    // CITABLE by the lane). The MOAT lane is in PRIMARY_FILING_LANES for THAT reason (B6: the grounded moat
    // thesis must be able to cite the resolver id, like the circle gate) — but it does NOT receive the full
    // primary-filing NUMBERS block in its prompt (that stays on the financial lanes). injectFilingNumbers
    // gates the prompt numbers block and EXCLUDES the moat lane.
    const injectFiling = primaryFilingBlock !== undefined && PRIMARY_FILING_LANES.has(lane)
    const injectFilingNumbers = injectFiling && lane !== 'moat'
    // model-tiering: the highest-stakes lane resolves its OWN registry role (moat → lane_moat);
    // every other lane uses lanes_default. Default = the run's provider/model so single-provider
    // runs are unchanged; an override can pin moat onto a stronger model.
    const laneRole: ModelRoleId = lane === 'moat' ? 'lane_moat' : 'lanes_default'
    const laneRuntime = resolveRoleRuntime(laneRole, provider, command)
    const sourceDiscipline = lane === 'risks'
      ? `As the RISKS lane you may cite anything — knowing the consensus IS the job.${RISKS_RECENCY_NOTE}`
      : lane === 'management'
        ? `Cite filings, proxies (DEF 14A), transcripts, and insider-trading data; media profiles will be rejected.`
        : `Cite filings, transcripts, regulatory/statistical data, and company disclosures; sell-side research, financial media, investor write-ups, and blogs will be rejected.`
    // S6: the pillar-1 lane's focus — it absorbs the retired business_quality lane AND
    // financial_quality's accounting-quality duty (the numeric duties are nationalized: the always-on
    // valuation stage, the T0 blocks, the moat tests).
    const laneFocus = lane === 'understand'
      ? ' PILLAR 1 — UNDERSTAND THE BUSINESS: explain how this business actually makes money — the '
        + 'business model, unit economics, revenue and cost drivers, segment structure, customer/supplier '
        + 'dynamics — AND the accounting quality (revenue recognition, one-offs, accrual red flags). '
        + 'Do NOT re-derive valuation numbers; the harness owns those.'
      : ''
    const basePrompt = `You are the Buffett-Munger ${lane} specialist agent for ${command.ticker}. `
      + `Produce a source-backed finding for the ${lane} lane only. Gather your own sources; return them in proposed_sources with real URLs. `
      + `SOURCE DISCIPLINE (Mechanism 6): this lane reasons from PRIMARY documents. ${sourceDiscipline}`
      + laneFocus
      + (injectFilingNumbers ? primaryFilingBlock : '')
      + (recentFilingsBlock !== undefined && RECENT_FILINGS_LANES.has(lane) ? recentFilingsBlock : '')
      + (proxyBlock !== undefined && PROXY_LANES.has(lane) ? proxyBlock : '')
      + (insiderBlock !== undefined && INSIDER_LANES.has(lane) ? insiderBlock : '')
      // S5: the harness-computed talent T0 + retained-earnings observations (management lane only).
      + (managementTalentBlock !== undefined && lane === 'management' ? managementTalentBlock : '')

    const baseRunId = `run_${command.research_case_id}_${swarmSeg(lane)}`
    // The grounded EDGAR 10-K is a guaranteed verified primary citation for the injected lanes —
    // include it in the lane's verified_ids so the lane records a finding even if the model proposed
    // no other verifiable source (this is what fixes the lane-drop when IR/news is blocked).
    const withFiling = (verified: string[]) =>
      injectFiling && primaryFilingSourceId !== undefined
        ? [...new Set([primaryFilingSourceId, ...verified])]
        : verified

    // ---- MOAT lane: emits its GROUNDED CITED THESIS (moat_drivers + proposed_moat_class) + runway_rubric ----
    // B6 reframe (mirror the circle gate): the moat is the model's grounded cited thesis, NOT a per-row
    // M1-M6 rubric. The lane runs under runValidatedAgent with moat_drivers + proposed_moat_class + the
    // runway_rubric REQUIRED — the retry FORCES them; only after 2 fails does the visible fallback (the
    // moat thesis is absent → resolver fails closed to narrow + judgment_degraded: rubric_not_emitted) apply.
    if (lane === 'moat') {
      const moatRequired: RequiredFieldCheck<z.infer<typeof MoatLaneSchema>>[] = [
        { name: 'moat_drivers', present: (a) => Array.isArray(a.moat_drivers) && a.moat_drivers.length > 0, hint: 'the durable competitive advantages, each {advantage, citation} cited to a verified primary source' },
        { name: 'proposed_moat_class', present: (a) => a.proposed_moat_class !== undefined, hint: "'narrow' | 'moderate' | 'wide' | 'monopoly' — your grounded moat judgment" },
        // S3: the pillar extensions are retry-FORCED (like the fields above); after retries the
        // resolver fails each closed (direction 'undetermined', no taxonomy chips, no peer table).
        { name: 'moat_direction', present: (a) => a.moat_direction !== undefined, hint: "'widening' | 'stable' | 'narrowing' — the moat's direction, with cited direction_drivers" },
        { name: 'direction_drivers', present: (a) => Array.isArray(a.direction_drivers) && a.direction_drivers.length > 0, hint: 'the observable direction evidence, each {evidence, citation} cited to a verified source' },
        { name: 'peer_standout', present: (a) => a.peer_standout !== undefined, hint: 'the standout test: named industry peers + their gross margins (cited-or-labeled) + your judgment' },
      ]
      const validated = await runValidatedAgent(laneRuntime.provider, {
        run_id: baseRunId,
        model_id: laneRuntime.model_id,
        // citation/corpus-alignment (KO regression): the moat lane does NOT get the full primary-filing
        // numbers block (that stays on the financial lanes), but it DOES get the pre-verified EDGAR
        // source_id so the qualitative moat rows (M3-M6) cite the harness-verified filing id rather than
        // the model's own flaky SEC-archive id — the exact bug that scored KO's wide-moat rows to 0.
        prompt: basePrompt + MOAT_PILLAR_PROMPT + (preVerifiedSourcesBlock ?? ''),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerMoatLane',
      }, MoatLaneSchema, {
        ...deps,
        lane,
        requiredFields: moatRequired,
        useToolLoop: true,
        readCorpus: accumulated,
        ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
      })
      const agent = validated.status === 'ok' ? validated.result : validated.lastResult
      if (agent === undefined) {
        // No payload parsed even after retries — treat as a failed lane (runLaneSwarm marks it incomplete).
        throw new Error(`Moat lane produced no parseable output: ${validated.status === 'failed' ? validated.reason : 'unknown'}`)
      }
      remember(agent.captured)
      const a = agent.analysis
      // B6: the grounded cited thesis is present only when BOTH the drivers (non-empty) and the proposed
      // class survived (a schema-valid live model always has them; the fallback path leaves moat_thesis
      // undefined → the resolver fails closed to narrow + judgment_degraded, never a silent admit).
      const moatThesisPresent =
        Array.isArray(a.moat_drivers) && a.moat_drivers.length > 0 && a.proposed_moat_class !== undefined
      // C2: the runway judged axis is retired — the judgment carries the moat thesis only.
      const moat_judgment: MoatLaneJudgment = {
        ...(moatThesisPresent
          ? {
              moat_thesis: {
                moat_drivers: a.moat_drivers,
                proposed_moat_class: a.proposed_moat_class,
                moat_reasoning: a.moat_reasoning ?? '',
                // S3: direction + peer standout ride the thesis; each fails closed in the resolver
                // when absent/ungrounded (direction 'undetermined', peers labeled model-asserted).
                ...(a.moat_direction !== undefined ? { moat_direction: a.moat_direction } : {}),
                ...(Array.isArray(a.direction_drivers) && a.direction_drivers.length > 0 ? { direction_drivers: a.direction_drivers } : {}),
                ...(a.direction_reasoning !== undefined ? { direction_reasoning: a.direction_reasoning } : {}),
                ...(a.peer_standout !== undefined ? { peer_standout: a.peer_standout } : {}),
              },
            }
          : {}),
      } as MoatLaneJudgment
      return {
        lane,
        finding_summary: a.finding_summary,
        confidence: a.confidence,
        caveats: a.caveats,
        verified_ids: withFiling(agent.verified_ids),
        ...(agent.usage === undefined ? {} : { usage: agent.usage }),
        wall_ms: Date.now() - laneStartedAt,
        moat_judgment,
        ...(agent.policy_rejections.length > 0 ? { policy_rejections: agent.policy_rejections } : {}),
        ...(validated.status === 'failed'
          ? { judgment_retry_degraded: `moat_lane_schema_retry_exhausted: the model omitted [${validated.missing.join(', ')}] after ${validated.attempts} attempts (${validated.reason}). Resolved holistically.` }
          : {}),
      }
    }

    // ---- UNDERSTAND lane (B3, Phase 4): the grounded finding + the book's ONE-PAGER ----
    // Mirrors the moat/management branches: runValidatedAgent with the one-pager retry-FORCED;
    // after retries the lane still records (finding + sources) with the one-pager honestly absent.
    if (lane === 'understand') {
      const understandRequired: RequiredFieldCheck<z.infer<typeof UnderstandLaneSchema>>[] = [
        { name: 'one_pager', present: (a) => a.one_pager !== undefined, hint: 'the seven-item one-pager: plain_english (one sentence), segments, revenue_drivers, most_profitable_segments, strengths, weak_spots, growth_levers' },
      ]
      const validated = await runValidatedAgent(laneRuntime.provider, {
        run_id: baseRunId,
        model_id: laneRuntime.model_id,
        prompt: basePrompt + UNDERSTAND_PILLAR_PROMPT + (preVerifiedSourcesBlock ?? ''),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerUnderstandLane',
      }, UnderstandLaneSchema, {
        ...deps,
        lane,
        requiredFields: understandRequired,
        useToolLoop: true,
        readCorpus: accumulated,
        ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
      })
      const agent = validated.status === 'ok' ? validated.result : validated.lastResult
      if (agent === undefined) {
        throw new Error(`Understand lane produced no parseable output: ${validated.status === 'failed' ? validated.reason : 'unknown'}`)
      }
      remember(agent.captured)
      const a = agent.analysis
      return {
        lane,
        finding_summary: a.finding_summary,
        confidence: a.confidence,
        caveats: a.caveats,
        verified_ids: withFiling(agent.verified_ids),
        ...(agent.usage === undefined ? {} : { usage: agent.usage }),
        wall_ms: Date.now() - laneStartedAt,
        ...(a.one_pager !== undefined ? { one_pager: a.one_pager } : {}),
        ...(agent.policy_rejections.length > 0 ? { policy_rejections: agent.policy_rejections } : {}),
        ...(validated.status === 'failed'
          ? { judgment_retry_degraded: `understand_lane_schema_retry_exhausted: the model omitted [${validated.missing.join(', ')}] after ${validated.attempts} attempts (${validated.reason}). The one-pager is absent.` }
          : {}),
      }
    }

    // ---- MANAGEMENT lane (S5, Phase 3): the pillar's two traits as GROUNDED CITED THESES ----
    // INTEGRITY (communication candor + DEF 14A comp structure) and TALENT (capital allocation,
    // reconciled against the injected T0 block). Mirrors the moat branch: runValidatedAgent with the
    // judgment blocks retry-FORCED; after retries the resolver fails closed to 'undetermined'
    // (never a silent clean bill, and the veto can only ever fire on grounded evidence).
    if (lane === 'management') {
      const mgmtRequired: RequiredFieldCheck<z.infer<typeof ManagementLaneSchema>>[] = [
        { name: 'integrity', present: (a) => a.integrity !== undefined, hint: 'the integrity judgment block: communication_observations [{observation, citation}], comp_structure {summary, alignment, citation → the grounded DEF 14A id}, integrity_flags, proposed_integrity, integrity_reasoning' },
        { name: 'talent', present: (a) => a.talent !== undefined, hint: 'the talent judgment block: talent_drivers [{evidence, citation}], proposed_talent, talent_reasoning — reconciled with the injected T0 observations' },
      ]
      const validated = await runValidatedAgent(laneRuntime.provider, {
        run_id: baseRunId,
        model_id: laneRuntime.model_id,
        prompt: basePrompt + MANAGEMENT_PILLAR_PROMPT + (preVerifiedSourcesBlock ?? ''),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerManagementLane',
      }, ManagementLaneSchema, {
        ...deps,
        lane,
        requiredFields: mgmtRequired,
        useToolLoop: true,
        readCorpus: accumulated,
        ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
      })
      const agent = validated.status === 'ok' ? validated.result : validated.lastResult
      if (agent === undefined) {
        throw new Error(`Management lane produced no parseable output: ${validated.status === 'failed' ? validated.reason : 'unknown'}`)
      }
      remember(agent.captured)
      const a = agent.analysis
      const management_judgment: ManagementLaneThesis = {
        ...(a.integrity !== undefined ? { integrity: a.integrity } : {}),
        ...(a.talent !== undefined ? { talent: a.talent } : {}),
      }
      return {
        lane,
        finding_summary: a.finding_summary,
        confidence: a.confidence,
        caveats: a.caveats,
        verified_ids: withFiling(agent.verified_ids),
        ...(agent.usage === undefined ? {} : { usage: agent.usage }),
        wall_ms: Date.now() - laneStartedAt,
        management_judgment,
        ...(agent.policy_rejections.length > 0 ? { policy_rejections: agent.policy_rejections } : {}),
        ...(validated.status === 'failed'
          ? { judgment_retry_degraded: `management_lane_schema_retry_exhausted: the model omitted [${validated.missing.join(', ')}] after ${validated.attempts} attempts (${validated.reason}). Resolved undetermined.` }
          : {}),
      }
    }

    // ---- Generic lanes (financial_quality, risks, …) ----
    // Deep-dive lanes gather REAL primary sources via the grounded tool loop when the provider supports it
    // (Phase 1 fetch_source/search_filings → Phase 2 structured), else fall back to propose-then-verify
    // UNCHANGED (Codex's internal sandbox gather, mock). The grounding/citation verification is identical.
    const { degraded_no_tools: _laneDegraded, ...agent } = await runGroundedAgentWithTools(laneRuntime.provider, {
      run_id: baseRunId,
      model_id: laneRuntime.model_id,
      prompt: basePrompt,
      timeout_ms: AGENT_TIMEOUT_MS,
      schema_name: 'BuffettMungerLaneFinding',
    }, LaneAgentSchema, {
      ...deps,
      readCorpus: accumulated,
      ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
    }, { lane })
    void _laneDegraded
    remember(agent.captured)
    return {
      lane,
      finding_summary: agent.analysis.finding_summary,
      confidence: agent.analysis.confidence,
      caveats: agent.analysis.caveats,
      ...(agent.usage === undefined ? {} : { usage: agent.usage }),
      wall_ms: Date.now() - laneStartedAt,
      verified_ids: withFiling(agent.verified_ids),
      ...(agent.policy_rejections.length > 0 ? { policy_rejections: agent.policy_rejections } : {}),
    }
  }

  // ---- Stage A (Pillars 1–2): understand + moat — the moat gate is judged BEFORE Pillar 3–4 spend ----
  // S6 (owner-locked): a below-gate moat SHORT-CIRCUITS the run by default (terminal dossier: Pillars
  // 1–2 answered, Pillars 3–4 "not evaluated — failed at the moat filter"; management/valuation/red-
  // team/synthesis provider spend never happens). A user-authored override (moat_gate_override) runs
  // everything anyway; the LATE verdict rails still gate the verdict — the override buys analysis, not
  // a pass. Historical 5-lane runs are unaffected (their events are already persisted).
  const stageALanes = lanes.filter((l) => l !== 'management')
  const stageAResults = await runLaneSwarm(stageALanes, runLaneFn, { concurrency: deps.laneConcurrency ?? 4 })

  // Extract the per-lane judgment outputs the harness now reads (instead of the synthesis schema).
  const moatLaneResult = stageAResults.find((l) => l.lane === 'moat')
  const moatJudgment = moatLaneResult?.moat_judgment
  // B3: the understand lane's one-pager (stage A) — carried to the analysis payload verbatim,
  // INCLUDING on the moat-gate short-circuit (Pillar 1 ran; its distillation is shown either way).
  const onePager = stageAResults.find((l) => l.lane === 'understand')?.one_pager
  // NOTE: shariahLaneJudgment is no longer read off the parallel deep-dive lane — it is now sourced from
  // the ALWAYS-ON focused Shariah-reasoning pass (runShariahReasoningPass, invoked below once the corpus
  // digest is assembled). See the derivation after synthesisRuntime.
  // FAIL-CLOSED (compliance is first-class): shariahDeepScreenIncomplete is now keyed off the focused
  // Shariah-reasoning PASS outcome — declared after shariahPassOutcome is resolved below. True whenever
  // the pass returns status:'failed' (schema-invalid response, unverified citation, or timeout). This
  // boolean rides ALONGSIDE the quick-screen verdict — it never fabricates or flips a genuinely-computed
  // verdict; it only marks the deep re-screen as incomplete so a human does not read a falsely-confident
  // COMPLIANT.

  // ---- Judgment objectivity (Mechanisms 1+2): rubric → mechanical anchor → bounded ±1 adjustment ----
  // Resolved from STAGE A alone (the management lane feeds neither the moat nor the runway axis) so
  // the EARLY moat gate below judges the exact tier the late rails will see — one source of truth.
  const stageACitationHashes = new Set<string>()
  for (const s of accumulated.values()) {
    // Only VERIFIED sources (content_hash present) enter the cite-check set — a captured-but-unverified
    // source_id (fetch failed: SSRF/404/redirect-exhausted/network) must not satisfy a citation.
    if (s.content_hash === undefined) continue
    stageACitationHashes.add(s.content_hash)
    stageACitationHashes.add(s.source_id) // a lane may cite by source_id; both are corpus-verified
  }
  const judgment = resolveJudgmentTiers({
    // MOAT (B6 reframe): the grounded cited thesis (moat_drivers + proposed_moat_class). When the lane
    // omitted it, the moat axis fails closed to narrow + judgment_degraded (the silent-skip guard).
    ...(moatJudgment?.moat_thesis !== undefined ? { moatThesis: moatJudgment.moat_thesis } : {}),
    ...(fundamentals?.annual_series !== undefined ? { series: fundamentals.annual_series } : {}),
    verifiedCitationHashes: stageACitationHashes,
  })

  // ---- S6: THE EARLY MOAT GATE — Pillar 2 must pass before Pillars 3–4 spend a token ----
  // GROUNDED-vs-UNGROUNDED mirrors the late rails exactly: a genuinely-narrow grounded thesis is a
  // set-aside (PASS); an unmet/capped/degraded thesis or an unbacked wide/monopoly claim is
  // incomplete research (RESEARCH_MORE) — same routing the full pipeline applies.
  const earlyResolvedMoatClass = judgment.moat!.resolved_moat_class
  const earlyProposedTier = judgment.moat?.proposed_tier
  const earlyMoatGrounded = !(
    judgment.moat?.moat_grounding_unmet === true
    || judgment.moat?.grounding_capped === true
    || judgment.moat?.judgment_degraded === 'rubric_not_emitted'
    || earlyProposedTier === 'wide' || earlyProposedTier === 'monopoly'
  )
  if (!moatPassesGate(buffettMungerStrategy, earlyResolvedMoatClass) && command.moat_gate_override !== true) {
    return await emitMoatGateShortCircuit({
      store, provider, command, strategyRef, accumulated, engineCommit,
      started, stageAResults, judgment,
      ...(moatTests !== undefined ? { moatTests } : {}),
      ...(circleJudgmentPayload !== undefined ? { circleJudgmentPayload } : {}),
      moatGrounded: earlyMoatGrounded,
    })
  }

  // ---- Stage B (Pillar 3): management — runs only past the moat gate (or under the override) ----
  const stageBResults = lanes.includes('management')
    ? await runLaneSwarm(['management'], runLaneFn, { concurrency: 1 })
    : []
  const laneResults: LaneSwarmResult[] = [...stageAResults, ...stageBResults]
  // S5: the management lane's raw integrity/talent blocks. A missing lane / omitted blocks resolve
  // 'undetermined' — never a silent clean.
  const managementLaneThesis = laneResults.find((l) => l.lane === 'management')?.management_judgment ?? {}

  // The FULL verified-citation set (Stage A + Stage B) for every downstream cite-check.
  const verifiedCitationHashes = new Set<string>()
  for (const s of accumulated.values()) {
    if (s.content_hash === undefined) continue
    verifiedCitationHashes.add(s.content_hash)
    verifiedCitationHashes.add(s.source_id)
  }

  // ---- S5 (Phase 3): resolve the MANAGEMENT pillar judgment (integrity + talent, grounded-only) ----
  const managementJudgment: ResolvedManagementJudgment = resolveManagementJudgment({
    thesis: managementLaneThesis,
    verifiedCitationHashes,
    ...(managementTalentT0?.roic.computable === true ? { t0RoicBand: managementTalentT0.roic.band } : {}),
  })

  // ---- Record specialist findings ----
  // C1: only record findings for lanes with at least one verified source id;
  // lanes with zero verified ids (incomplete or all-sources-unverified) are
  // skipped and noted so incompleteness surfaces in synthesis caveats.
  const findings: Awaited<ReturnType<typeof recordSpecialistFinding>>[] = []
  const laneNotes: string[] = []
  // Mechanism 6: aggregate the per-lane source-discipline rejections for the dossier (visible —
  // a classification lane starved of primary docs degrades/fails-closed; it never fabricates).
  const sourcePolicyRejections = laneResults.flatMap((lane) =>
    (lane.policy_rejections ?? []).map((r) => ({ lane: lane.lane, ...r })),
  )
  for (const lane of laneResults) {
    if (lane.verified_ids.length === 0) {
      const reason = lane.status === 'incomplete' ? 'incomplete' : 'no verifiable sources'
      laneNotes.push(`${lane.lane}: skipped (${reason})`)
      continue
    }
    findings.push(await recordSpecialistFinding(store, {
      research_case_id: command.research_case_id,
      finding_id: `finding_${swarmSeg(command.research_case_id)}_${swarmSeg(lane.lane)}`,
      deep_dive_id: started.deep_dive_id,
      ...strategyRef,
      specialist_lane: lane.lane,
      finding_summary: lane.finding_summary,
      confidence: lane.confidence,
      // Phase 2 V5: the lane's spend (1 grounded call; tokens when the provider reported usage).
      ...(lane.wall_ms === undefined ? {} : {
        stage_cost: {
          provider_calls: 1,
          ...(lane.usage?.input_tokens === undefined ? {} : { input_tokens: lane.usage.input_tokens }),
          ...(lane.usage?.output_tokens === undefined ? {} : { output_tokens: lane.usage.output_tokens }),
          wall_ms: lane.wall_ms,
        },
      }),
      caveats: lane.status === 'incomplete' ? [...lane.caveats, 'status:incomplete'] : lane.caveats,
      source_ids: lane.verified_ids,
      causation_id: started.event_id,
      actor_id: provider.provider_id,
      idempotency_key: `specialist-finding:${command.research_case_id}:${lane.lane}:v1`,
    }))
  }

  // C1 edge case: if NO lane produced a recorded finding, abort before synthesis
  if (findings.length === 0) {
    throw new Error(`No specialist lane produced a verifiable source for ${command.ticker}; research aborted (fail-closed).`)
  }

  // ---- Mechanism 5: Red-Team Pass (after the 5 lanes, BEFORE synthesis) ----
  // One adversarial grounded agent whose ONLY mandate is to break the case. It receives a compact
  // digest of the lane findings + the mechanically-computed anchor tiers + the verified source corpus,
  // and cites the SAME corpus (it is the consensus-knowing lane — allowed all source categories). Its
  // strongest objection is cite-checked; synthesis is then OBLIGED to answer it or downgrade. A
  // red-team timeout DEGRADES (red_team_incomplete) — the run continues so a completed 5-lane deep dive
  // is never discarded. model-tiering-spec: the red team now resolves the `red_team` registry role —
  // when an override pins a DIFFERENT provider/model it genuinely runs on a different model than the
  // lanes (catches shared-narrative error single-model cross-checks cannot). Default = the run's model.
  const redTeamRuntime = resolveRoleRuntime('red_team', provider, command)
  const inversionStartedAt = Date.now() // Phase 2 V5: inversion stage-cost wall clock
  const corpusBeforeSynthesis = [...accumulated.values()]
  const corpusHashesBeforeSynthesis = new Set<string>()
  for (const s of corpusBeforeSynthesis) {
    // Only VERIFIED sources (content_hash present) enter the cite-check set — a captured-but-unverified
    // source_id (fetch failed: SSRF/404/redirect-exhausted/network) must not satisfy a citation.
    if (s.content_hash === undefined) continue
    corpusHashesBeforeSynthesis.add(s.content_hash)
    corpusHashesBeforeSynthesis.add(s.source_id)
  }
  const laneDigest: InversionLaneDigest[] = laneResults
    .filter((l) => l.verified_ids.length > 0)
    .map((l) => ({ lane: l.lane, finding_summary: l.finding_summary, confidence: l.confidence }))
  // ---- Phase 2 V1: the ALWAYS-ON valuation-judgment stage (between the lanes and synthesis) ----
  // The focused valuation call is PROMOTED from a fallback to a dedicated stage: it owns the grounded
  // valuation judgment (owner-earnings basis + assumed growth + citations, plus — V1 — the judged
  // buy-below, valuation_status, and bridge inputs), recorded as `valuation_judgment_drafted` with its
  // stage cost. In V1 the monolithic decision's fields are still tolerated; when the decision drops or
  // fails to ground its valuation_reasoning, THIS artifact is adopted (no second focused call).
  const valuationStageRuntime = resolveRoleRuntime('synthesis', provider, command)
  const valuationStageStartedAt = Date.now()
  const valuationStageOutcome = await runValuationReasoningPass(
    valuationStageRuntime.provider,
    {
      research_case_id: command.research_case_id,
      ticker: command.ticker,
      model_id: valuationStageRuntime.model_id,
      laneDigest,
      corpusSourceIds: [...accumulated.values()].map((s) => s.source_id),
      preVerifiedSourceIds: primaryFilingSourceId !== undefined ? [primaryFilingSourceId] : [],
      caseDigest: {
        moat_class: judgment.moat!.resolved_moat_class,
      },
      ...(primaryFilingBlock === undefined ? {} : { primaryFilingBlock }),
      circleDigest: {
        drivers: (circleJudgmentPayload['cashflow_drivers'] as { driver?: string }[] | undefined ?? []).map((d) => d.driver ?? '').filter((d) => d.length > 0),
        breakers: (circleJudgmentPayload['predictability_breakers'] as { breaker?: string }[] | undefined ?? []).map((b) => b.breaker ?? '').filter((b) => b.length > 0),
      },
    },
    { ...(deps.ground === undefined ? {} : { ground: deps.ground }), ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }) },
  )
  if (valuationStageOutcome.status === 'ok') {
    remember(valuationStageOutcome.captured)
  }
  await store.append({
    event_id: `evt_valuation_judgment_drafted_${command.research_case_id}`,
    event_type: 'valuation_judgment_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    causation_id: started.event_id,
    actor_type: 'provider',
    actor_id: valuationStageRuntime.model_id,
    payload: {
      valuation_judgment_id: `valuation_${swarmSeg(command.research_case_id)}`,
      research_case_id: command.research_case_id,
      company_id: command.company_id,
      ticker: command.ticker,
      status: valuationStageOutcome.status,
      ...(valuationStageOutcome.status === 'ok'
        ? {
            assumed_growth: valuationStageOutcome.valuation_reasoning.assumed_growth,
            assumed_growth_rationale: valuationStageOutcome.valuation_reasoning.assumed_growth_rationale,
            assumed_growth_citation: valuationStageOutcome.valuation_reasoning.assumed_growth_citation,
          }
        : { failure_reason: valuationStageOutcome.reason }),
      corpus_source_ids: [...accumulated.values()].map((s) => s.source_id),
      stage_cost: {
        provider_calls: 1,
        ...(valuationStageOutcome.status === 'ok' && valuationStageOutcome.usage?.input_tokens !== undefined ? { input_tokens: valuationStageOutcome.usage.input_tokens } : {}),
        ...(valuationStageOutcome.status === 'ok' && valuationStageOutcome.usage?.output_tokens !== undefined ? { output_tokens: valuationStageOutcome.usage.output_tokens } : {}),
        wall_ms: Date.now() - valuationStageStartedAt,
      },
    },
    source_ids: valuationStageOutcome.status === 'ok' ? valuationStageOutcome.verified_ids : [],
    created_at: new Date().toISOString(),
    schema_version: 1,
    idempotency_key: `valuation-judgment:${command.research_case_id}:v1`,
  } satisfies LedgerEventEnvelope<unknown>)

  const inversion: InversionResult = await runInversionPass(
    redTeamRuntime.provider,
    {
      research_case_id: command.research_case_id,
      ticker: command.ticker,
      // model-tiering: reuses the red_team registry role id (config stability) — a DIFFERENT model when overridden.
      model_id: redTeamRuntime.model_id,
      laneDigest,
      // The moat/runway tiers are now resolved from the MOAT lane's rubric BEFORE the red team runs,
      // so the red team gets the concrete resolved tiers as its target (not a pending placeholder).
      caseDigest: {
        moat_class: judgment.moat!.resolved_moat_class,
      },
      corpusSourceIds: corpusBeforeSynthesis.map((s) => s.source_id),
      verifiedCitationHashes: corpusHashesBeforeSynthesis,
    },
    { ...(deps.ground === undefined ? {} : { ground: deps.ground }), ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }) },
  )

  // E1: the inversion digest injected into the synthesis prompt — the verdict must WEIGH the strongest
  // case against before deciding (Munger: invert, always invert). No answer-or-downgrade obligation
  // machinery; the payload records the inversion and the human audits it on the dossier.
  const redTeamPromptBlock = inversion.status === 'complete'
    ? `\n\nINVERSION (Munger: invert, always invert — weigh this before your verdict): the case was argued AGAINST itself. `
      + `STRONGEST OBJECTION (severity ${inversion.strongest_objection.severity}): "${inversion.strongest_objection.claim}" `
      + `[cited: ${inversion.strongest_objection.citations.join(', ') || 'no verified citation'}]. `
      + `Case against: ${inversion.strongest_case_against} Moat-decay: ${inversion.moat_decay_scenario} Growth-credit attack: ${inversion.growth_credit_attack}. `
      + `Your verdict + rationale must weigh this counter-argument on its merits.`
    : `\n\nINVERSION: the inversion pass did not complete (${inversion.reason}); the case was NOT argued against itself. `
      + `Proceed, but the harness will surface this gap.`

  // ---- Synthesis + decision agent (harness defense 1: schema validation + retry) ----
  // model-tiering-spec: the synthesis runs on the `synthesis` registry role (T1). Default = the run's
  // provider/model so single-provider runs are unchanged; an override can pin it onto a frontier model.
  const synthesisRuntime = resolveRoleRuntime('synthesis', provider, command)

  // ---- FOCUSED Shariah-reasoning pass (ALWAYS-ON) ----
  // The Shariah compliance overlay (sector_status + impermissible_income + a grounded sector_citation) is
  // produced by a dedicated focused, grounded, retried call — the SAME cite-check discipline as the
  // valuation-reasoning pass — instead of being read off the parallel deep-dive lane. It runs
  // UNCONDITIONALLY (every deep dive) and reuses the SAME laneDigest / corpus / pre-verified-EDGAR inputs
  // the valuation pass assembles. Its output becomes shariahLaneJudgment, which the AAOIFI recompute below
  // (and the synthesis reconciliation prompt) source from. On failure the overlay is left undefined so the
  // recompute fails CLOSED to UNDETERMINED (the visible shariah_ratios_unverified degradation) — never a
  // silently-clean verdict. (sector_citation is retained for cite-checking, NOT the ratio recompute, so
  // only sector_status + impermissible_income map onto the ShariahLaneJudgment shape here.)
  // model-tiering-spec: the Shariah pass runs on the `lane_shariah` registry role — this is the highest-
  // stakes hard-stop classification, so it respects any operator override pinned on lane_shariah. Falls
  // back to the run's provider/model when no override is configured (identical behavior to before).
  const shariahPassRuntime = resolveRoleRuntime('lane_shariah', provider, command)
  // S2 dedupe: the SAME reasoning pass already ran at the front gate. When the verified corpus is
  // UNCHANGED since the gate judged (no lane/stage grounded a new source), re-running it would re-ask
  // the same question of the same evidence — reuse the gate's grounded judgment instead. Any corpus
  // growth (the normal full-run case) re-runs the pass so the judgment refines on lane evidence. A
  // gate_incomplete or undetermined gate never short-circuits this refinement.
  const frontGateEvent = (await store.list()).find(
    (e) => e.event_id === command.gate_event_id && e.event_type === 'shariah_gate_judged',
  )
  const frontGatePayload = frontGateEvent?.payload as Record<string, unknown> | undefined
  const frontGateSectorRaw = frontGatePayload?.['sector_status']
  const frontGateSector: 'compliant' | 'conditional' | 'non_compliant' | undefined =
    frontGateSectorRaw === 'compliant' || frontGateSectorRaw === 'conditional' || frontGateSectorRaw === 'non_compliant'
      ? frontGateSectorRaw
      : undefined
  const frontGateCorpusIds = Array.isArray(frontGatePayload?.['corpus_source_ids'])
    ? new Set((frontGatePayload['corpus_source_ids'] as unknown[]).map(String))
    : undefined
  const corpusIdsNow = [...accumulated.values()].map((s) => s.source_id)
  const reusableGateJudgment =
    frontGateCorpusIds !== undefined
    && frontGatePayload?.['gate_incomplete'] !== true
    && frontGateSector !== undefined
    && corpusIdsNow.length === frontGateCorpusIds.size
    && corpusIdsNow.every((id) => frontGateCorpusIds.has(id))
  const shariahPassOutcome = reusableGateJudgment
    ? {
        status: 'ok' as const,
        shariah_judgment: {
          sector_status: frontGateSector,
          sector_reasoning: typeof frontGatePayload?.['sector_reasoning'] === 'string'
            ? frontGatePayload['sector_reasoning']
            : 'Reused from the front Shariah gate judgment (corpus unchanged since the gate).',
          impermissible_income: typeof frontGatePayload?.['impermissible_income'] === 'number'
            ? frontGatePayload['impermissible_income']
            : null,
          sector_citation: frontGateEvent?.source_ids[0] ?? '',
        },
        verified_ids: [...(frontGateEvent?.source_ids ?? [])],
        captured: [] as CapturedSource[],
      }
    : await runShariahReasoningPass(
    shariahPassRuntime.provider,
    {
      research_case_id: command.research_case_id,
      ticker: command.ticker,
      model_id: shariahPassRuntime.model_id,
      laneDigest,
      corpusSourceIds: [...accumulated.values()].map((s) => s.source_id),
      preVerifiedSourceIds: primaryFilingSourceId !== undefined ? [primaryFilingSourceId] : [],
      ...(fundamentals?.latest_annual?.impermissible_income_lines === undefined
        ? {}
        : { impermissibleIncomeLines: fundamentals.latest_annual.impermissible_income_lines }),
    },
    {
      ...(deps.ground === undefined ? {} : { ground: deps.ground }),
      ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
      // The same verified corpus the lanes read from — lets the pass read_source the filing's notes to
      // QUANTIFY impermissible income (the SPGI-class gap: untagged in XBRL, absent from the digest).
      readCorpus: accumulated,
    },
  )
  const shariahLaneJudgment: ShariahLaneJudgment | undefined = shariahPassOutcome.status === 'ok'
    ? {
        sector_status: shariahPassOutcome.shariah_judgment.sector_status,
        impermissible_income: shariahPassOutcome.shariah_judgment.impermissible_income,
      }
    : undefined
  // Task 3: shariahDeepScreenIncomplete keys off the focused Shariah-reasoning PASS outcome.
  // True whenever the pass returns status:'failed' (schema-invalid response, unverified citation, or
  // timeout). The verdict is NOT flipped — this flag rides ALONGSIDE as a human-visible caveat.
  const shariahDeepScreenIncomplete = shariahPassOutcome.status !== 'ok'

  // Spec-correct decomposition: the moat/runway rubric + the Shariah overlay are produced + retried on their
  // OWN specialist lanes, and the red-team response on its OWN focused call (below). Synthesis therefore has
  // NO judgment-overlay required fields — it just produces the verdict/thesis/valuation/Shariah rationale.
  // Founding-risk fix: the decision agent's valuation/growth claims must be GROUNDED in a verified source of
  // its OWN — so the citation fields are REQUIRED (runValidatedAgent retries when the model omits them). The
  // post-synthesis cite-check below then verifies they resolve against the corpus; absent/unverifiable →
  // synthesis_grounding_unmet → RESEARCH_MORE (the model's confident verdict is NOT recorded).
  // Phase 2 V4: the valuation-citation required-field checks moved WITH the fields to the valuation
  // stage (runValuationReasoningPass enforces its own citations); synthesis keeps only its audit surface.
  const synthesisRequiredFields: RequiredFieldCheck<z.infer<typeof DecisionAgentSchema>>[] = [
    {
      name: 'key_wrong_assumption',
      present: (a) => (a.key_wrong_assumption ?? '').trim().length > 0,
      hint: 'the SINGLE concrete assumption that, if wrong, breaks the thesis (name the assumed growth rate / moat-durability claim / maintenance-capex judgment you actually made — not boilerplate)',
    },
    {
      name: 'thesis_break_triggers',
      present: (a) => Array.isArray(a.thesis_break_triggers) && a.thesis_break_triggers.some((t) => (t ?? '').trim().length > 0),
      hint: 'concrete OBSERVABLE events tied to THIS business that would invalidate the thesis ("gross margin falls below X%", "top-2 customer concentration rises") — not generic "if growth slows"',
    },
  ]
  let dec: GroundedAgentResult<z.infer<typeof DecisionAgentSchema>>
  // Surfaced when the validate→retry wrapper exhausted its attempts and we fell back to the degraded
  // (still-parsed) payload — recorded as a visible degraded flag below so the gap is never silent.
  // (Synthesis has no required overlay fields now; this remains for any future required-field addition.)
  let synthesisValidationDegraded: string | undefined
  const synthesisStartedAt = Date.now() // Phase 2 V5: synthesis stage-cost wall clock
  try {
    const validated = await runValidatedAgent(synthesisRuntime.provider, {
    run_id: `run_${command.research_case_id}_synthesis`,
    model_id: synthesisRuntime.model_id,
    prompt: `You are the Buffett-Munger synthesis+decision agent for ${command.ticker}. `
      + `Using the lane findings, produce a verdict, thesis, evidence, valuation rationale, Shariah rationale, risks, open questions, and a synthesis summary. `
      // B2 (live kimi find, 2026-07-11): the model wrote "verdict is HOLD" (not in the enum) and
      // self-mapped it to PASS — losing the watchlist candidacy. Calibrate the vocabulary explicitly.
      + `VERDICT VOCABULARY: emit ONLY BUY | WATCH | PASS | RESEARCH_MORE. There is no HOLD verdict — a `
      + `quality business at-or-near fair value that you would buy cheaper is WATCH (parked with its re-arm `
      + `price), NOT PASS. PASS means the business itself fails a filter (moat, management, comprehension) — `
      + `price alone never makes a wonderful business a PASS. Rule 9: do NOT demand every box tick — judge `
      + `the thesis as a whole. `
      + `Report incremental_roic (normalized INCREMENTAL ROIC as a fraction, e.g. 0.20) alongside reinvestment_rate (reported context). `
      // Phase 2 V4: the valuation judgment (owner-earnings bridge, assumed growth + citations, the
      // buy-below, valuation_status) is OWNED by the dedicated valuation stage that already ran — the
      // artifact is injected here for RECONCILIATION; this monolithic call no longer carries the fields.
      + (valuationStageOutcome.status === 'ok'
        ? `THE VALUATION STAGE already produced the grounded valuation judgment — reconcile with it, do NOT re-value: `
          + `assumed_growth=${valuationStageOutcome.valuation_reasoning.assumed_growth}, `
          + `basis: the harness's deterministic FCF (CFO − capex) intrinsic value ` 
        : `The valuation stage did not produce a grounded judgment (${valuationStageOutcome.status === 'failed' ? valuationStageOutcome.reason : 'unavailable'}) — the harness records the valuation as ungrounded; write your valuation_rationale accordingly (do not fabricate figures). `)
      + `MARGIN-OF-SAFETY AUDIT SURFACE — REQUIRED, do not omit: key_wrong_assumption and thesis_break_triggers, SPECIFIC to THIS business's thesis. key_wrong_assumption = the SINGLE assumption that, if WRONG, breaks this thesis — name a CONCRETE assumption you actually made (the assumed growth rate, the moat-durability claim, the maintenance-capex judgment), NOT a generic placeholder. thesis_break_triggers = the concrete, OBSERVABLE events that would invalidate the thesis, tied to THIS business (e.g. "gross margin falls below X%", "the top-2 customer concentration rises above Y%", "a funded entrant takes >Z% share") — NOT generic boilerplate like "if growth slows". Vague or generic answers are NOT acceptable. These are your forward-looking RISK reasoning for the human to audit; the harness does NOT cite-check them, but they MUST be substantive and business-specific. IMPORTANT: these REQUIRED audit artifacts do NOT argue against your own verdict — every sound thesis still has a nameable wrong-assumption and concrete break triggers; recording them is bookkeeping for the human, not evidence of fragility. Judge the verdict on the thesis itself. `
      // The moat/runway classification + rubrics and the Shariah overlay are produced by the MOAT and
      // SHARIAH specialist lanes — NOT here. The harness has already resolved them; the resolved tiers are
      // handed to you below for RECONCILIATION only (you do not re-score them).
      + `The MOAT lane resolved moat_class='${judgment.moat!.resolved_moat_class}'`
      + (shariahLaneJudgment !== undefined ? `; the Shariah screen assessed sector_status='${shariahLaneJudgment.sector_status}'` : '')
      + `. Reconcile your verdict + rationale with these resolved classifications; do NOT re-score the rubrics. `
      + `Cite sources in proposed_sources with real URLs.`
      // citation/corpus-alignment (KO regression): surface the harness's already-verified EDGAR source_id
      // so assumed_growth_citation cites the id the harness reliably verifies
      // (the cite-check below FAILS CLOSED on an unverifiable citation) instead of the model's own flaky
      // SEC-archive id.
      + (preVerifiedSourcesBlock ?? '')
      + redTeamPromptBlock,
    timeout_ms: AGENT_TIMEOUT_MS,
    schema_name: 'BuffettMungerSynthesisDecision',
    }, DecisionAgentSchema, {
      ...(deps.ground === undefined ? {} : { ground: deps.ground }),
      ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
      requiredFields: synthesisRequiredFields,
    })
    if (validated.status === 'ok') {
      dec = validated.result
    } else if (validated.lastResult !== undefined) {
      // Retries exhausted but a schema-valid payload parsed (the high-stakes fields are still missing).
      // Reconcile with the existing stopgap: FALL BACK to the visible-degradation path (resolveJudgmentTiers
      // → holistic moat/runway; lane Shariah verdict; red_team_objection_unaddressed) so the RUN completes
      // rather than aborting. Record WHY it degraded so the gap is visible (never silent).
      dec = validated.lastResult
      synthesisValidationDegraded =
        `synthesis_schema_retry_exhausted: the model omitted the required structured field(s) `
        + `[${validated.missing.join(', ')}] after ${validated.attempts} attempts (${validated.reason}). `
        + `Proceeded on the degraded payload via the holistic/lane fallback — re-run on a more capable model.`
    } else {
      // No payload parsed at all after retries (invalid JSON / schema mismatch). Lane findings are
      // persisted (lanes_completed: true) so the run is resumable. Fail cleanly.
      throw new ResearchSwarmStageError('synthesis', new ValidatedAgentFailedError(validated.missing, validated.attempts, validated.reason), { lanes_completed: true })
    }
  } catch (error) {
    if (error instanceof ResearchSwarmStageError) throw error
    // Synthesis retry exhausted (transient/provider error): lane findings are already persisted
    // (lanes_completed: true) so the run is resumable. Fail cleanly instead of a raw provider/timeout error.
    throw new ResearchSwarmStageError('synthesis', error, { lanes_completed: true })
  }
  remember(dec.captured)

  // ---- Synthesis OWN-GROUNDING gate (founding-risk fix) ----
  // The synthesis/decision agent's verdict + valuation/growth claims must be grounded in a VERIFIED source
  // of its OWN — not merely in the union corpus the lanes already grounded (which is never empty, so the
  // old all-corpus check at 1228 never fired). Build a verification Set over the POST-synthesis corpus
  // (now that the decision agent's own captured sources are in `accumulated`) holding BOTH the content_hash
  // AND the source_id of every verified source — mirror lines 999-1002 — then cite-check the two valuation
  // citations against it (the SAME mechanism the rubric/red-team use). Layer 1: dec.verified_ids must be
  // non-empty (the agent grounded at least one source itself). Layer 2: each valuation citation must be
  // present AND verify. Deterministic verifies GROUNDING; semantic relevance stays the human's audit.
  const synthesisCorpusHashes = new Set<string>()
  for (const s of accumulated.values()) {
    // Only VERIFIED sources (content_hash present) enter the cite-check set — a captured-but-unverified
    // source_id (fetch failed: SSRF/404/redirect-exhausted/network) must not satisfy a citation.
    if (s.content_hash === undefined) continue
    synthesisCorpusHashes.add(s.content_hash)
    synthesisCorpusHashes.add(s.source_id) // a citation may be by source_id OR content_hash; both are corpus-verified
  }
  // Phase 2 V1b: the valuation STAGE's artifact is the PRIMARY valuation_reasoning; the monolithic
  // decision's block is the legacy fallback (tolerated until V4 drops it). The first candidate whose
  // citations cite-check wins; with none grounded the first candidate carries (visibly unmet below).
  // Phase 2 V4: the STAGE is the only owner (the monolithic decision no longer carries the block).
  const valuationCandidates: ValuationReasoning[] = [
    ...(valuationStageOutcome.status === 'ok' ? [valuationStageOutcome.valuation_reasoning] : []),
  ]
  let valuationReasoning: ValuationReasoning | undefined = valuationCandidates[0]
  // Cite-check the (possibly-replaced) valuation_reasoning citations against the content_hash-verified corpus.
  // E2: the owner-earnings citation is retired — the growth citation is the stage's grounding gate.
  const groundValuation = (vr: ValuationReasoning | undefined): { growthGrounded: boolean; growthCite?: string } => {
    const growthCite = vr?.assumed_growth_citation
    return {
      growthGrounded: growthCite !== undefined && isCitationGrounded(growthCite, synthesisCorpusHashes),
      ...(growthCite === undefined ? {} : { growthCite }),
    }
  }
  for (const candidate of valuationCandidates) {
    if (groundValuation(candidate).growthGrounded) {
      valuationReasoning = candidate
      break
    }
  }
  const g = groundValuation(valuationReasoning)
  // The VALUATION part of the grounding gate (owner-earnings + assumed-growth citations). The dec.verified_ids
  // layer (the agent grounded at least one source of its OWN) is independent of the valuation_reasoning and is
  // NOT something the focused call can repair — it stays evaluated on the decision agent itself.
  const valuationGroundingUnmet =
    valuationReasoning === undefined || !g.growthGrounded

  // ---- FOCUSED valuation-reasoning fallback (the focused decomposition) ----
  // The monolithic decision schema intermittently DROPS valuation_reasoning (KO: the narrative reasoned a
  // clean WATCH — "wide moat, durably predictable, but EXPENSIVE" — but the structured owner-earnings +
  // assumed-growth citation fields fell out under the monolithic load). A1 then fail-closes to RESEARCH_MORE.
  // Mirror the red-team-response precedent: when the decision dropped/ungrounded valuation_reasoning, run a
  // SMALL focused grounded call whose ONLY output is the valuation_reasoning, steered to the harness-verified
  // EDGAR id. Re-evaluate the cite-check against its result; if it grounds → the valuation grounding gate is
  // MET and the verdict lands. Fail-closed PRESERVED: if the focused call ALSO can't ground (omits it OR cites
  // an ungrounded id), valuationGroundingUnmet stays true → RESEARCH_MORE + a visible degradation note. The
  // happy path (the decision produced a grounded valuation_reasoning) NEVER fires this call.
  let valuationReasoningDegraded: string | undefined
  if (valuationGroundingUnmet) {
    // Phase 2 V1b: both candidates (the always-on stage artifact AND the monolithic decision's block)
    // were already tried above — nothing is re-called here; the gate stays unmet with a VISIBLE note.
    valuationReasoningDegraded = valuationStageOutcome.status === 'ok'
      ? 'valuation_reasoning_retry_exhausted: neither the valuation stage nor the synthesis produced '
        + 'an assumed-growth citation that verifies against the corpus — the valuation stays '
        + 'ungrounded. Routed to RESEARCH_MORE; re-run on a more capable model.'
      : `valuation_reasoning_retry_exhausted: the valuation stage did not produce a usable, grounded `
        + `valuation_reasoning after ${valuationStageOutcome.attempts} attempt(s) (${valuationStageOutcome.reason}) `
        + `and the synthesis fallback also failed to ground one. Routed to RESEARCH_MORE; re-run.`
  }

  // ---- Citation-alignment fold (dogfood 2026-07-10: live COST/SPGI) ----
  // The decision agent is STEERED to cite the harness-verified EDGAR id instead of re-fetching its own
  // copy of the filing — so a cite-VERIFIED corpus source must satisfy the own-grounding layer. Fold
  // the verified valuation-citation ids into dec.verified_ids (source_id-shaped only — never a raw
  // content hash, since these ids flow into event source_ids). The layer still fails closed when the
  // agent cited nothing verifiable at all (Test 1 shape: its citations do not verify → nothing folds).
  for (const cite of [g.growthCite]) {
    if (cite === undefined || dec.verified_ids.includes(cite)) continue
    const corpusMatch = accumulated.get(cite)
    if (corpusMatch !== undefined && corpusMatch.content_hash !== undefined) {
      dec.verified_ids = [...dec.verified_ids, cite]
    }
  }

  const assumedGrowthCitation = g.growthCite
  const synthesisGroundingUnmet =
    dec.verified_ids.length === 0
    || valuationGroundingUnmet
  // Human-readable reason naming WHICH layer/claim failed (surfaced as a visible degraded flag below).
  const synthesisGroundingReason: string | undefined = !synthesisGroundingUnmet
    ? undefined
    : dec.verified_ids.length === 0
      ? 'synthesis_grounding_unmet: the decision agent cited no verified source of its own (dec.verified_ids empty) — '
        + 'a confident verdict citing nothing verifiable. Routed to RESEARCH_MORE; re-run.'
      : valuationReasoning === undefined
        ? 'synthesis_grounding_unmet: the valuation stage produced no valuation_reasoning (assumed growth + citation) '
          + '— its valuation is ungrounded. Routed to RESEARCH_MORE; re-run.'
        : `synthesis_grounding_unmet: assumed_growth_citation '${assumedGrowthCitation ?? '(absent)'}' did not verify `
          + 'against the corpus — the assumed-growth rationale is ungrounded. Routed to RESEARCH_MORE; re-run.'

  // ---- E1: build the inversion layer (no obligation machinery — the payload records it) ----
  const { layer: inversionLayer, openQuestion: inversionOpenQuestion } = buildInversionLayer({ inversion })
  // Phase 2 V5: the inversion stage's spend (one focused call — the red-team response pass is retired).
  ;(inversionLayer as Record<string, unknown>)['stage_cost'] = {
    provider_calls: 1,
    wall_ms: Date.now() - inversionStartedAt,
  }

  const allVerified = [
    ...new Set([
      ...command.gate_source_ids,
      ...findings.flatMap((f) => f.source_ids),
      ...dec.verified_ids,
    ]),
  ]

  // I1: fail-closed if synthesis has no verifiable sources
  if (allVerified.length === 0) {
    throw new Error(`Synthesis for ${command.ticker} has no verifiable sources (fail-closed).`)
  }

  // I3: derive synthesis confidence from lane outcomes
  const synthesisConfidence = (laneNotes.length > 0 || findings.some((f) => f.confidence === 'low')) ? 'low' : 'medium'

  // I3: append lane notes to caveats so incompleteness is not silently dropped
  const synthesisCaveats = laneNotes.length > 0
    ? [...dec.analysis.open_questions, ...laneNotes]
    : dec.analysis.open_questions

  const synthesis = await draftDeepDiveSynthesis(store, {
    // Phase 2 V5: the synthesis stage's spend (the monolithic decision call; tokens when reported).
    ...(dec.usage === undefined ? { stage_cost: { provider_calls: 1, wall_ms: Date.now() - synthesisStartedAt } } : {
      stage_cost: {
        provider_calls: 1,
        ...(dec.usage.input_tokens === undefined ? {} : { input_tokens: dec.usage.input_tokens }),
        ...(dec.usage.output_tokens === undefined ? {} : { output_tokens: dec.usage.output_tokens }),
        wall_ms: Date.now() - synthesisStartedAt,
      },
    }),
    research_case_id: command.research_case_id,
    synthesis_id: `synthesis_${swarmSeg(command.research_case_id)}`,
    deep_dive_id: started.deep_dive_id,
    ...strategyRef,
    synthesis_summary: dec.analysis.synthesis_summary,
    confidence: synthesisConfidence,
    caveats: synthesisCaveats,
    source_ids: allVerified,
    specialist_finding_ids: findings.map((f) => f.finding_id),
    causation_id: findings.at(-1)?.event_id ?? started.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-synthesis:${command.research_case_id}:v1`,
  })

  const completed = await completeDeepDive(store, {
    research_case_id: command.research_case_id,
    completion_id: `complete_${swarmSeg(command.research_case_id)}`,
    deep_dive_id: started.deep_dive_id,
    ...strategyRef,
    synthesis_id: synthesis.synthesis_id,
    confidence: synthesisConfidence,
    caveats: synthesisCaveats,
    source_ids: allVerified,
    causation_id: synthesis.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-complete:${command.research_case_id}:v1`,
  })

  // ---- Harness-computed valuation (two-stage DCF — buffett-valuation-method-v2) ----
  // The bridge fields are company TOTALS in $millions; shares_outstanding is in millions. We compute
  // TOTAL owner earnings, then divide by shares_outstanding to get a PER-SHARE figure (OE_ps).
  //   OE_total = NI + D&A - maint_capex - SBC - dNWC  (dNWC signed: positive=use of cash reduces OE)
  //   OE_ps    = OE_total / shares_outstanding
  // Credited growth g (Step 3): the demonstrated OE/share CAGR through the named humility cap (Phase 1.3).
  // Terminal growth g_t (Step 4): UNIFORM 1.5% for every investable moat (F.13 — the monopoly tier no longer
  //   raises g_t). Discount (F.2): the config-driven compliant SAVINGS rate + a fixed equity premium
  //   (≈7.5% default), UNIFORM across every moat — no longer a flat 10%, and the retired interest-bearing
  //   Treasury is no longer the anchor (a compliant investor cannot hold it).
  // Two-stage FV (Step 2 + 4): stage-1 horizon is UNIFORM 10 yrs for every investable moat (F.13). Stage-1
  //   growth is NO LONGER flat — it compounds at g over the plateau years then LINEARLY FADES to g_t over the
  //   trailing growth_fade_years (Part D Step 2; F=5 → years 6–10), so OE_t = OE_ps·Π_{i=1..t}(1+g_i) with g_i
  //   gliding g → g_t. The Gordon terminal attaches off the faded year-10 OE. Fade bites only when g > g_t.
  //   FV_ps > 18 × OE_ps raises a surfaced cap_exceeded flag (not a silent truncation).
  // Buy price (Step 5): round(FV_ps × (1 − MoS), 2)  MoS = UNIFORM 25% base for every investable moat (F.13),
  //   widened by documented uncertainty. A monopoly is a durability signal, not a valuation-loosening lever.

  // ---- Visible degraded flags (Mechanism: no SILENT skip) ----
  // Every OPTIONAL structured field the model omitted is recorded as an explicit flag here and appended
  // to the decision open_questions below (mirroring the working red_team_objection_unaddressed pattern),
  // so a human (and the next dogfood) SEES exactly what the model failed to provide.
  const degradedFlags: string[] = []
  // Harness defense 1: when the synthesis validate→retry wrapper exhausted its attempts and we fell back
  // to the degraded payload, surface WHY (the required field — synthesis_response — the model kept
  // omitting) — visible.
  if (synthesisValidationDegraded !== undefined) {
    degradedFlags.push(synthesisValidationDegraded)
  }
  // Founding-risk fix: the decision agent's OWN grounding was unmet (no verified source of its own and/or an
  // ungrounded valuation/growth citation). Surfaced the SAME way as the other degradation flags (recorded in
  // valuation.degraded_flags + appended to the decision open_questions) so it is never silent. The verdict is
  // routed to RESEARCH_MORE in gatedVerdict below — the model's confident verdict is NOT recorded.
  if (synthesisGroundingReason !== undefined) {
    degradedFlags.push(synthesisGroundingReason)
  }
  // The focused valuation-reasoning fallback fired but could not ground a valuation_reasoning (the focused
  // decomposition's own visible fallback — mirrors red_team_response_retry_exhausted). Surfaced so the gap is
  // seen; the verdict is routed to RESEARCH_MORE via synthesisGroundingUnmet above.
  if (valuationReasoningDegraded !== undefined) {
    degradedFlags.push(valuationReasoningDegraded)
  }
  // Per-lane schema-retry exhaustion (the moat lane omitted its REQUIRED judgment block after 2 attempts)
  // — surfaced exactly like the synthesis path so the gap is visible, not silent.
  if (moatLaneResult?.judgment_retry_degraded !== undefined) degradedFlags.push(moatLaneResult.judgment_retry_degraded)
  // Shariah-reasoning PASS failure: the focused pass returned status:'failed' (schema-invalid response,
  // unverified citation, or timeout). Surfaced so the gap is visible alongside shariahDeepScreenIncomplete.
  if (shariahPassOutcome.status === 'failed') {
    degradedFlags.push(`shariah_reasoning_pass_failed: ${shariahPassOutcome.reason}`)
  }
  // FAIL-CLOSED deep-screen caveat: the Shariah-reasoning focused pass failed to ground, so the deep
  // RE-SCREEN did not run. Surface it in the string channel (open_questions) alongside the projected
  // boolean — the verdict rests on the quick-screen gate, NOT a grounded deep re-screen.
  if (shariahDeepScreenIncomplete) {
    degradedFlags.push(
      'shariah_ratios_unverified: shariah_deep_screen_incomplete — the focused Shariah-reasoning pass did not ground '
      + '(schema-invalid response, unverified citation, or timeout), so the deep compliance re-screen '
      + '(segment-revenue + impermissible-income) did not complete; the verdict rests on the quick-screen gate.',
    )
  }
  if (judgment.moat?.judgment_degraded === 'rubric_not_emitted') {
    degradedFlags.push(
      'judgment_degraded: rubric_not_emitted — the model omitted the grounded moat thesis; the moat '
      + 'class was resolved from the holistic lane judgment (or a conservative default), '
      + 'NOT from a grounded, cite-verified thesis.',
    )
  }
  // resolved_moat_class is guaranteed defined by resolveJudgmentTiers (never undefined).
  const primaryMoatClass = judgment.moat!.resolved_moat_class

  // ---- model-tiering-spec: Dual-Model Cross-Check (moat class + Shariah sector status ONLY) ----
  // OFF by default. When the registry pins a DISTINCT model on lane_moat_crosscheck / lane_shariah_
  // crosscheck, the harness re-classifies that ONE dimension on the second model and compares:
  //   agreement → proceed (record crosscheck.agreed=true);
  //   disagreement → take the CONSERVATIVE answer (lower moat tier / stricter Shariah) and flag
  //                  requires_human_escalation (appended to open_questions); the conservative answer
  //                  holds in the meantime. A cross-check timeout DEGRADES (primary holds, gap surfaced).
  // "Don't extend everywhere — it doubles cost." Reuses the lane timeout/degrade guard.
  const crossCheckOpenQuestions: string[] = []
  let moatCrossCheckLayer: CrossCheckLayer | undefined
  let shariahCrossCheckLayer: CrossCheckLayer | undefined

  const moatCrossCheckRuntime = resolveCrossCheckRuntime('lane_moat_crosscheck', provider, command)
  let resolvedMoatClass: MoatClass = primaryMoatClass
  if (moatCrossCheckRuntime !== undefined) {
    const moatXc = await resolveCrossCheck<MoatClass>({
      dimension: 'moat_class',
      primary: primaryMoatClass,
      primaryModel: synthesisRuntime.model_id,
      crossCheckModel: moatCrossCheckRuntime.model_id,
      compare: compareMoatClass,
      runCrossCheck: async () => {
        const agent = await runGroundedAgent(moatCrossCheckRuntime.provider, {
          run_id: `run_${command.research_case_id}_moat_crosscheck`,
          model_id: moatCrossCheckRuntime.model_id,
          prompt: `You are an INDEPENDENT moat-classification cross-checker for ${command.ticker}. `
            + `Classify the durable competitive moat as exactly one of: narrow | moderate | wide | monopoly. `
            + `Reason ONLY from primary filings and cite at least one real, fetchable source in proposed_sources. `
            + `Be disciplined — judge from the filings' evidence alone: do NOT inflate the moat from narrative, and equally do NOT manufacture narrowness the filings do not support. Under-crediting a demonstrated moat is as much an error as over-crediting one.`,
          timeout_ms: AGENT_TIMEOUT_MS,
          schema_name: 'MoatCrossCheck',
        }, MoatCrossCheckSchema, deps, { lane: 'moat' })
        remember(agent.captured)
        return agent.analysis.moat_class as MoatClass
      },
    })
    resolvedMoatClass = moatXc.value
    moatCrossCheckLayer = moatXc.crosscheck
    if (moatXc.escalation_note !== undefined) crossCheckOpenQuestions.push(moatXc.escalation_note)
    if (moatXc.degraded_note !== undefined) degradedFlags.push(moatXc.degraded_note)
  }
  const moatClass = resolvedMoatClass
  const moat_passes_gate = moatPassesGate(buffettMungerStrategy, moatClass)

  // ---- moat_grounding_unmet: distinguish an UNGROUNDED moat from a genuinely-NARROW one ----
  // When the moat fails the gate (below wide), WHY it failed changes the routing (gatedVerdict below):
  //   - UNGROUNDED  (the model REACHED for a wide+ moat but the cite-verified qualitative rows did not
  //     back it) -> route to RESEARCH_MORE: the thesis is incomplete, not disproven. "Ungrounded" =
  //       (a) grounding_capped: an upward bump to a gate-passing tier was DENIED for lack of grounded rows;
  //       (b) judgment_degraded: the moat resolved via the holistic fallback (rubric not emitted/scored);
  //       (c) the model PROPOSED a gate-passing tier (wide/monopoly) but it did not resolve there.
  //   - GENUINELY NARROW (the model did not claim a passing tier, or the grounded evidence simply adds to
  //     narrow/moderate) -> keep PASS: set aside, outside the wide-moat circle, no further research owed.
  // Surfaced the SAME way as synthesis_grounding_unmet (A1): a visible boolean + reason on the valuation
  // payload, projected legacy-tolerantly, displayed near the verdict.
  const moatProposedTier = judgment.moat?.proposed_tier
  const modelClaimedPassingMoat = moatProposedTier === 'wide' || moatProposedTier === 'monopoly'
  // B6: the grounded-thesis resolver sets moat_grounding_unmet directly (model claimed wide/monopoly but
  // the grounded drivers couldn't back it). grounding_capped mirrors it. judgment_degraded fires when no
  // thesis was emitted at all. Any of these → the moat claim is UNGROUNDED (vs genuinely narrow).
  const moatThesisUnmet = judgment.moat?.moat_grounding_unmet === true
  const moatGroundingCapped = judgment.moat?.grounding_capped === true
  const moatJudgmentDegraded = judgment.moat?.judgment_degraded === 'rubric_not_emitted'
  const moat_grounding_unmet =
    !moat_passes_gate
    && (moatThesisUnmet || moatGroundingCapped || moatJudgmentDegraded || (modelClaimedPassingMoat && !moat_passes_gate))
  const moatGroundingReason: string | undefined = !moat_grounding_unmet
    ? undefined
    : moatGroundingCapped
      ? `moat_grounding_unmet: the moat resolved to '${moatClass}' (below the wide-moat gate) — an upward `
        + 'tier bump to a gate-passing moat was DENIED because the cite-verified qualitative rows (M3 pricing '
        + 'power, M4 share, M5 switching, M6 competitor exits) did not support it. The quant corroborates but '
        + 'cannot substitute for a grounded qualitative moat thesis. Routed to RESEARCH_MORE; ground the moat.'
      : moatJudgmentDegraded
        ? `moat_grounding_unmet: the moat resolved to '${moatClass}' via the holistic fallback (rubric not `
          + 'scored / not emitted) — the moat class was NOT established from cite-verified rubric rows. Routed '
          + 'to RESEARCH_MORE; emit a scored, grounded moat rubric.'
        : `moat_grounding_unmet: the model proposed a '${moatProposedTier}' moat but it resolved to '${moatClass}' `
          + '(below the wide-moat gate) — the cite-verified qualitative rows did not back the claimed moat. '
          + 'Routed to RESEARCH_MORE; ground the moat thesis.'
  // Surface the ungrounded-moat reason as a visible degraded flag (mirrors synthesis_grounding_unmet).
  if (moatGroundingReason !== undefined) {
    degradedFlags.push(moatGroundingReason)
  }

  // ---- E2 (owner-locked 2026-07-12): OWNER EARNINGS IS RETIRED ----------------------------------
  // The book basis is the ONLY basis: FCF = CFO − capex, both tagged XBRL facts (T0). The judged
  // owner-earnings bridge (maintenance-capex proxy tier + normalized ΔWC — the two most assumption-
  // heavy numbers in the engine) is gone from the stage schema and from this file. A filer that does
  // not tag CFO gets an HONESTLY UNPRICED dossier (thresholds deferred on data) — never a proxy-built
  // fallback. The purely factual capex-vs-D&A note survives as the reinvestment-mix read.
  const edgarAnnual = fundamentals?.latest_annual
  const shares_outstanding: number =
    edgarAnnual?.diluted_shares_m !== undefined
    && Number.isFinite(edgarAnnual.diluted_shares_m)
    && edgarAnnual.diluted_shares_m > 0
      ? edgarAnnual.diluted_shares_m
      : Number.NaN
  const shares_valid = Number.isFinite(shares_outstanding) && shares_outstanding > 0
  const reporting_currency = fundamentals?.currency

  // The FCF basis row: the latest EDGAR year where CFO − capex is computable.
  const latestFcfRow = fundamentals?.annual_series !== undefined
    ? [...fundamentals.annual_series].sort((a, b) => b.fiscal_year - a.fiscal_year).find((a) => yearFcf(a) !== undefined)
    : undefined
  const latestFcfMusd = latestFcfRow !== undefined ? yearFcf(latestFcfRow) : undefined
  if (latestFcfMusd === undefined) {
    degradedFlags.push(
      'fcf_not_computable: free cash flow (CFO − capex) is not computable for this filer (CFO or capex '
      + 'untagged in the EDGAR series) — the dossier is honestly UNPRICED (fail-closed). No intrinsic '
      + 'value, buy threshold, or zone is emitted; owner-earnings proxies are retired and never substitute.',
    )
  }
  // T0 provenance for the FCF basis (replaces the owner-earnings bridge block).
  const fcfBasis = latestFcfRow !== undefined
    ? {
        fiscal_year: latestFcfRow.fiscal_year,
        ...(latestFcfRow.cfo_musd !== undefined ? { cfo_musd: latestFcfRow.cfo_musd } : {}),
        ...(latestFcfRow.capex_musd !== undefined ? { capex_musd: latestFcfRow.capex_musd } : {}),
        fcf_musd: latestFcfMusd as number,
        ...(reporting_currency !== undefined ? { reporting_currency } : {}),
        ...(primaryFilingSourceId !== undefined ? { source_id: primaryFilingSourceId } : {}),
      }
    : undefined

  // E2 survivor: the purely FACTUAL capex-vs-D&A note (no maintenance-capex proxy, no assumptions).
  const capexVsDa = capexVsDandANote(edgarAnnual)

  // ---- Phase 2 V3 (owner-validated option A): foreign-filer FX — the price-currency basis ----
  // EDGAR money facts are in the filing\'s REPORTING currency; the live price is USD per LISTED share
  // (ADR for foreign filers). fxFactor converts reporting-currency money into the USD/listed-share
  // frame (× ADR ratio × fx). A missing FX rate BLOCKS the per-share valuation (fail-closed, flagged)
  // — never a silent currency mix (the NVO bug).
  let fxFactor: number | undefined = 1
  let fxConversion: { reporting_currency: string; price_currency: 'USD'; fx_rate_to_usd: number; adr_ordinary_per_listed: number; adr_ratio_source: 'curated' | 'assumed_1' } | undefined
  if (reporting_currency !== undefined && reporting_currency !== 'USD') {
    const fxToUsd = await resolveFxRateValue(reporting_currency, deps)
    const curatedRatio = curatedAdrRatio(command.ticker)
    const adrRatio = curatedRatio ?? 1
    if (fxToUsd === undefined || !Number.isFinite(fxToUsd) || fxToUsd <= 0) {
      fxFactor = undefined
      degradedFlags.push(
        `fx_unavailable_valuation_blocked: the filer reports in ${reporting_currency} but no ${reporting_currency}→USD rate `
        + `resolved — the per-share valuation (intrinsic value / buy zone / implied growth) is blocked rather than `
        + `mixing currencies (fail-closed). The AAOIFI ratio block handles its own conversion separately.`,
      )
    } else {
      fxFactor = adrRatio * fxToUsd
      fxConversion = {
        reporting_currency,
        price_currency: 'USD',
        fx_rate_to_usd: fxToUsd,
        adr_ordinary_per_listed: adrRatio,
        adr_ratio_source: curatedRatio !== undefined ? 'curated' : 'assumed_1',
      }
      if (curatedRatio === undefined) {
        degradedFlags.push(
          `adr_ratio_assumed: 1 listed (ADR) share assumed = 1 ordinary share for ${command.ticker} — no curated ratio in `
          + `ADR_ORDINARY_SHARES_PER_LISTED. If the real depositary ratio differs, per-share values are scaled wrong; `
          + `curate the entry (strategies/adrRatios).`,
        )
      }
    }
  }
  // Reporting-currency $M → the USD/listed-share money frame (per-share math divides by shares below).
  const toUsdMusd = (v: number | undefined): number | undefined =>
    v !== undefined && Number.isFinite(v) && fxFactor !== undefined ? v * fxFactor : undefined
  const fcfMusdUsd = toUsdMusd(latestFcfMusd)
  const cashMusdUsd = toUsdMusd(edgarAnnual?.cash_and_securities_musd)
  const debtMusdUsd = toUsdMusd(edgarAnnual?.total_debt_musd)


  // F.2 ANCHOR SWAP (SHIPPED): discount = the COMPLIANT risk-free SAVINGS rate (fail-closed to the config
  // default savings rate) + the fixed uniform equity premium (Phase 1.4 / Step 3). GLOBAL config, never an
  // agent input, no quality knob. The compliant investor's true risk-free is the savings rate they could
  // actually hold (the SAME baseline the deployment-hurdle + sizing engines use), NOT the interest-bearing
  // 10y Treasury (retired — it cannot be held compliantly). Sourced from the threaded app-config savings
  // rate; fails closed to `savings_rate_default` when absent / non-finite / non-positive.
  const threadedRiskFree = command.risk_free_rate
  const risk_free_from_config = typeof threadedRiskFree === 'number'
    && Number.isFinite(threadedRiskFree)
    && threadedRiskFree > 0
  const risk_free_rate = risk_free_from_config
    ? threadedRiskFree
    : buffettMungerStrategy.valuation.savings_rate_default
  void risk_free_rate // retained for the deployment-hurdle/sizing baseline; no longer the valuation discount
  // Phase 4 (book alignment, owner-locked): the valuation DISCOUNT is the REQUIRED RETURN — flat 15%
  // default ("anything less, buy the index"), user-set in Settings and threaded per run. The savings
  // anchor is RETIRED as the valuation discount (it remains the deployment-hurdle baseline).
  const threadedRequiredReturn = command.required_return
  const required_return_from_config = typeof threadedRequiredReturn === 'number'
    && Number.isFinite(threadedRequiredReturn)
    && threadedRequiredReturn > 0
    && threadedRequiredReturn < 1
  const required_return = required_return_from_config
    ? threadedRequiredReturn
    : VALUATION_PARAMS.required_return_default
  const discount = required_return
  // ---- Harness defense 3: range/sanity checks on model-proposed numerics (BEFORE the valuation) ----
  // Implausible model numbers are rejected deterministically and never fed into the valuation — a
  // rejected value falls back to a safe/not-computable value + a VISIBLE flag (mirrors degraded_flags).
  // "If a component's output can be computed, compute it" — and an implausible input is discarded, not
  // trusted. The EDGAR-computed incremental ROIC (computeIncrementalRoic, range-guarded) overrides the
  // model value when available; these checks defend the model-proposed path.
  const roicSanity = sanitizeRoicLike(dec.analysis.roic, { field: 'roic' })
  if (roicSanity.rejected && roicSanity.flag !== undefined) degradedFlags.push(roicSanity.flag)
  // Reported ROIC is context; a rejected value is floored to 0 (no >20% exceptional signal credited).
  const roic = roicSanity.value ?? 0
  // ---- Incremental ROIC: harness-computed from the EDGAR multi-year series when reliable ----
  // (buffett-valuation-method-v2 Step 3). NOPAT proxy = operating income × (1 − eff. tax) [or NI +
  // after-tax interest]; invested capital proxy = equity + total debt − cash; incremental ROIC ≈
  // Δ(NOPAT)/Δ(invested capital) over ~5 yrs. We use the harness value for growth eligibility/credit
  // and FALL BACK to the lane's proposed incremental_roic when EDGAR data is insufficient or the
  // proxy is unreliable (negative/odd) — keeping it honest with a recorded note.
  const laneIncRoicSanity = sanitizeRoicLike(dec.analysis.incremental_roic, { field: 'incremental_roic' })
  if (laneIncRoicSanity.rejected && laneIncRoicSanity.flag !== undefined) degradedFlags.push(laneIncRoicSanity.flag)
  // A rejected lane incremental_roic floors to 0 (ineligible for growth credit) — never the garbage value.
  const laneIncrementalRoic = laneIncRoicSanity.value ?? 0
  let incremental_roic = laneIncrementalRoic
  let incremental_roic_basis: 'sec_edgar' | 'model_proposed' = 'model_proposed'
  if (fundamentals?.annual_series !== undefined && fundamentals.annual_series.length >= 2) {
    const incRoic = computeIncrementalRoic(fundamentals.annual_series)
    if (incRoic.computable) {
      incremental_roic = incRoic.incremental_roic
      incremental_roic_basis = 'sec_edgar'
    }
  }
  const reinvestmentSanity = sanitizeReinvestmentRate(dec.analysis.reinvestment_rate)
  if (reinvestmentSanity.rejected && reinvestmentSanity.flag !== undefined) degradedFlags.push(reinvestmentSanity.flag)
  // A rejected reinvestment_rate floors to 0 (no growth credited from an implausible rate).
  const reinvestment_rate = reinvestmentSanity.value ?? 0

  const valuationCaveats: string[] = []
  // E2: the reference value is the BOOK FCF intrinsic value ONLY (set below when computable) — the
  // internal OE DCF, 18× ceiling, Gordon terminal, and implied_multiple are all retired.
  let mosReferenceValue: number | undefined

  // NOTE (R1): maintenance-capex confidence was a widening input for the retired required_growth_gap engine
  // (deleted in R2). The relightened decision no longer widens a deterministic conservatism knob — the
  // model owns the valuation judgment — so the low-maint-capex-confidence signal is no longer consumed here.

  // ---- ONE growth path (Phase 1.3): honest demonstrated OE/share growth + named cap + above-GDP flag ----
  // The growth rate is the demonstrated historical owner-earnings-per-share CAGR from the EDGAR series
  // (the falsifiable, near-recent-history input), passed through the named ~20% forecasting-humility cap.
  // The lane may argue LOWER (never higher) via its growth_assumptions; an above-GDP rate is flagged
  // lowest-confidence (a moat-durability claim — Part D Step 2 coupling). NO reinvestment×ROIC bands.
  // Demonstrated growth is the ROBUST log-linear OE/share slope over the trailing window (split-adjusted),
  // NOT the legacy endpoint CAGR — a single outlier year cannot whipsaw the slope. Fail-closed to g=0 (no
  // growth) when the measure returns undefined (fewer than three positive points / non-finite inputs), exactly
  // as the prior endpoint path floored to 0. Any split adjustment or residual discontinuity is surfaced as a
  // degraded flag so the dossier shows WHY the demonstrated rate may move.
  const demonstratedGrowthResult = fundamentals?.annual_series !== undefined
    ? demonstratedOwnerEarningsGrowth(fundamentals.annual_series, { metric: 'fcf' })
    : undefined
  const demonstrated_growth = demonstratedGrowthResult?.growth ?? 0
  if (demonstratedGrowthResult !== undefined) {
    for (const flag of demonstratedGrowthResult.flags) {
      degradedFlags.push(`demonstrated_growth: ${flag}`)
    }
  }
  // The lane's argued growth (if any) may only REDUCE the demonstrated rate. We pass the parsed lane rate
  // when present; creditedGrowth ignores it unless strictly lower. (Lane prose stays in growth_assumptions.)
  const laneArguedGrowth = parseLaneArguedGrowth(dec.analysis.growth_assumptions)
  // Advisory notes produced BEFORE the sanity_flags block below exists (flag-relevance review,
  // 2026-07-11): these are QUESTIONS for the human, not harness fallbacks — carrying them in
  // degraded_flags made healthy dossiers read as damaged. Merged into sanity_flags at declaration.
  const advisorySanityCarryover: string[] = []
  // E2 survivor: the factual reinvestment-mix read (advisory when heavy; never a proxy, never a block).
  if (capexVsDa.growth_capex_heavy) advisorySanityCarryover.push(`capex_mix: ${capexVsDa.note}`)
  const growthResult = creditedGrowth(buffettMungerStrategy, {
    demonstrated_growth,
    ...(laneArguedGrowth !== undefined ? { agent_proposed_growth: laneArguedGrowth } : {}),
  })
  const effective_growth_rate = growthResult.growth
  // FIX (live find, V rc_v_1783881150952): the lane-argue parser can bind a DECOMPOSITION fragment
  // ("3% real GDP" inside a 9%-growth rationale) as the lane arguing total growth down — which then
  // masqueraded as the "demonstrated history" (a false above-history flag) and SUPPRESSED the growth
  // base-rate burden. The demonstrated-history rate is the capped demonstrated measure, NO lane-argue.
  const demonstrated_capped = creditedGrowth(buffettMungerStrategy, { demonstrated_growth }).growth
  const growth_basis: 'edgar_fcf_cagr' | 'none' =
    fundamentals?.annual_series !== undefined && demonstrated_growth > 0 ? 'edgar_fcf_cagr' : 'none'
  // Above-GDP coupling flag → surfaced so growth is reviewed WITH the moat-durability input.
  if (moat_passes_gate && growthResult.above_gdp && growthResult.above_gdp_flag !== undefined) {
    advisorySanityCarryover.push(growthResult.above_gdp_flag)
  }
  if (moat_passes_gate && demonstrated_capped === 0) {
    degradedFlags.push(
      'valuation_degraded: demonstrated_growth_reference_floored_g0 — the demonstrated FCF/share '
      + 'CAGR was unavailable or non-positive, so the demonstrated-history reference growth was floored to g=0 '
      + '(honest no-growth floor). This is a SANITY reference, not the headline; the headline forward-DCF uses '
      + "the model's cited assumed_growth.",
    )
  }

  // ---- HEADLINE GROWTH = the MODEL's cite-verified assumed_growth (architecture inversion) ----
  // The architecture: the model's grounded, cited judgment is the analysis; the deterministic credited-g
  // (demonstrated CAGR, capped, lane-may-argue-lower) is a SANITY reference, NEVER the headline. So the
  // headline growth + headline forward-DCF FV are driven by the model's `assumed_growth` (the SAME value A1
  // grounds via assumed_growth_citation). The capped credited-g (effective_growth_rate) is DEMOTED to a
  // demonstrated-history reference (`demonstrated_growth_reference`) + an advisory flag (below).
  //
  // A1 coupling: assumed_growth must be cite-verified — if synthesisGroundingUnmet, A1 already routes the
  // verdict to RESEARCH_MORE, so we do NOT fall back to credited-g as the headline. We adopt the model's
  // assumed_growth as the headline ONLY when grounding is met AND the value is finite + non-negative; an
  // absent/ungrounded assumed_growth leaves the headline growth undefined (degrade per A1).
  const modelAssumedGrowth = valuationReasoning?.assumed_growth
  const assumedGrowthUsable =
    !synthesisGroundingUnmet
    && modelAssumedGrowth !== undefined
    && Number.isFinite(modelAssumedGrowth)
    && modelAssumedGrowth >= 0
  // An assumed growth above the named single_growth_cap is FLAGGED, not silently trusted — the human
  // audits whether the cited source defends it. The flag is advisory; the value is still recorded as the
  // model's headline (the model owns it). Emitted ONCE, in the sanity_flags channel (block (a) of the
  // sanity checks below) — the cap applies to the MODEL's judgment, never the market-implied read.
  const headline_growth: number | undefined = assumedGrowthUsable ? modelAssumedGrowth : undefined

  // E2: the FCF basis gates pricing — honest caveats when it cannot compute (no OE substitutes).
  if (!shares_valid) {
    valuationCaveats.push(
      'Valuation not computed: diluted shares missing or non-positive — cannot derive a per-share value. Re-run with a grounded share count before relying on any buy price.',
    )
  } else if (latestFcfMusd !== undefined && latestFcfMusd <= 0) {
    valuationCaveats.push(
      `Valuation not computed: free cash flow (CFO − capex) is not positive (${latestFcfMusd.toFixed(0)}M) — the book model does not price a cash-burning year. No intrinsic value or buy price emitted.`,
    )
  } else if (latestFcfMusd === undefined) {
    valuationCaveats.push(
      'Valuation not computed: free cash flow (CFO − capex) is not computable for this filer — honestly unpriced (fail-closed; owner-earnings proxies are retired).',
    )
  }

  // ---- Market cap + harness-computed AAOIFI Shariah FINANCIAL ratios ----
  // buffett-pipeline-spec-v2 Lane 5 / valuation-recalibration-spec want the 36-MONTH AVERAGE market
  // cap for the debt/cash ratios. We compute avg(month-end price over ~36 mo) × EDGAR diluted shares
  // and use THAT; FAIL-CLOSED to the current-price market cap when monthly history is unavailable.
  const current_price = await resolveCurrentPriceValue(command.ticker, deps)
  const spotMarketCap = (current_price !== undefined && shares_valid)
    ? current_price * shares_outstanding
    : undefined
  const avgMarketCap = shares_valid
    ? await resolveAverageMarketCapValue(command.ticker, shares_outstanding, deps)
    : undefined
  const market_cap = avgMarketCap?.market_cap ?? spotMarketCap
  const market_cap_basis: 'avg_36mo_x_diluted_shares' | 'current_price_x_diluted_shares' =
    avgMarketCap !== undefined ? 'avg_36mo_x_diluted_shares' : 'current_price_x_diluted_shares'
  // The currency of the market_cap figure. Yahoo prices US-listed tickers (including ADRs) in USD.
  // The avg path carries an explicit currency from the Yahoo chart meta; the spot path defaults to USD.
  const market_cap_currency: string = avgMarketCap?.currency ?? 'USD'

  // ---- E2: market-implied growth — the BOOK model inverted (attachment/presentation only) ----
  // "What growth does TODAY'S price imply under the SAME book model the valuation uses?" — the reverse
  // solve of fcfIntrinsicValuePerShare (same FCF base, required return, exit multiple, net cash,
  // horizon), so reverse and forward stay consistent. Fail-closed: omitted when no current price or no
  // positive FCF (never fabricate a price or a rate). It does NOT consume the model's assumed_growth,
  // so it stays computable when the assumed growth is ungrounded.
  const exitProposed = valuationStageOutcome.status === 'ok'
    ? valuationStageOutcome.valuation_reasoning.industry_exit_multiple
    : undefined
  const exitCitationGrounded = exitProposed?.citation !== undefined
    && isCitationGrounded(exitProposed.citation, verifiedCitationHashes)
  // OWNER RULE (2026-07-12): the reference band IS the named-comps set — median of the model's own
  // structured comps, checked deterministically by the resolver (no fixed clamp; absurdity guard only).
  const exitCompsPfcf = (exitProposed?.comps ?? [])
    .map((c) => c.p_fcf)
    .filter((x): x is number => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b)
  const exitCompsMedian = exitCompsPfcf.length > 0
    ? (exitCompsPfcf.length % 2 === 1
        ? exitCompsPfcf[(exitCompsPfcf.length - 1) / 2]!
        : (exitCompsPfcf[exitCompsPfcf.length / 2 - 1]! + exitCompsPfcf[exitCompsPfcf.length / 2]!) / 2)
    : undefined
  const exitResolution = resolveExitMultiple({
    ...(exitProposed?.multiple !== undefined ? { proposed: exitProposed.multiple } : {}),
    grounded: exitCitationGrounded,
    ...(exitCompsMedian !== undefined ? { comps_median: exitCompsMedian } : {}),
  })
  // The exit-multiple self-consistency reads (comps median / unstructured / absurd-fallback) join
  // the advisory sanity channel — visible, never blocking.
  advisorySanityCarryover.push(...exitResolution.flags)
  let market_implied_growth: number | undefined
  if (current_price !== undefined && fcfMusdUsd !== undefined && fcfMusdUsd > 0 && shares_valid) {
    market_implied_growth = fcfImpliedGrowth({
      price_per_share: current_price,
      fcf_musd: fcfMusdUsd,
      required_return,
      exit_multiple: exitResolution.multiple,
      ...(cashMusdUsd !== undefined ? { cash_musd: cashMusdUsd } : {}),
      ...(debtMusdUsd !== undefined ? { total_debt_musd: debtMusdUsd } : {}),
      shares_m: shares_outstanding,
      horizon: VALUATION_PARAMS.stage1_horizon,
    })
  }

  // The SHARIAH lane (LLM) identifies the sector status + impermissible income ($M); the harness
  // RECOMPUTES the three AAOIFI financial ratios + verdict + purification % from EDGAR debt/cash/
  // revenue + market cap — re-verifying the model rather than trusting its ratio arithmetic. When
  // EDGAR/market-cap/impermissible-income are missing it is not computable and we fall back to the
  // lane's proposed (quick-screen) Shariah verdict. The SECTOR FAIL hard stop is independent of this
  // financial-ratio layer (handled by the quick-screen short-circuit + sector_status below).
  // Dual-model cross-check for the SHARIAH SECTOR STATUS (the second high-stakes classification). OFF by
  // default; when a distinct lane_shariah_crosscheck model is configured AND the synthesis supplied a
  // sector_status, the second model re-classifies the sector and the conservative (stricter) status
  // holds on disagreement (+ human escalation). The impermissible_income overlay is untouched (it feeds
  // the harness ratio recompute, not a model classification).
  // Spec-correct decomposition: the overlay now comes from the always-on Shariah-reasoning pass (via shariahLaneJudgment above), not the lane and not the synthesis schema.
  let shariahJudgment: ShariahLaneJudgment | undefined = shariahLaneJudgment
  const shariahCrossCheckRuntime = resolveCrossCheckRuntime('lane_shariah_crosscheck', provider, command)
  if (shariahCrossCheckRuntime !== undefined && shariahJudgment !== undefined) {
    const primarySector = shariahJudgment.sector_status as ShariahSectorStatus
    const shariahXc = await resolveCrossCheck<ShariahSectorStatus>({
      dimension: 'shariah_sector_status',
      primary: primarySector,
      primaryModel: synthesisRuntime.model_id,
      crossCheckModel: shariahCrossCheckRuntime.model_id,
      compare: compareShariahSectorStatus,
      runCrossCheck: async () => {
        const agent = await runGroundedAgent(shariahCrossCheckRuntime.provider, {
          run_id: `run_${command.research_case_id}_shariah_crosscheck`,
          model_id: shariahCrossCheckRuntime.model_id,
          prompt: `You are an INDEPENDENT Shariah SECTOR-status cross-checker for ${command.ticker}. `
            + `Classify the company's PRIMARY-BUSINESS sector permissibility as exactly one of: `
            + `compliant | conditional | non_compliant. Reason ONLY from filings/segment disclosures and `
            + `cite at least one real, fetchable source in proposed_sources. Be strict — when in doubt, `
            + `choose the more conservative (stricter) status.`,
          timeout_ms: AGENT_TIMEOUT_MS,
          schema_name: 'ShariahSectorCrossCheck',
        }, ShariahCrossCheckSchema, deps, { lane: 'shariah' })
        remember(agent.captured)
        return agent.analysis.sector_status as ShariahSectorStatus
      },
    })
    shariahCrossCheckLayer = shariahXc.crosscheck
    if (shariahXc.escalation_note !== undefined) crossCheckOpenQuestions.push(shariahXc.escalation_note)
    if (shariahXc.degraded_note !== undefined) degradedFlags.push(shariahXc.degraded_note)
    // Hold the conservative (stricter) sector status; impermissible_income overlay unchanged.
    shariahJudgment = { ...shariahJudgment, sector_status: shariahXc.value }
  }
  let shariah_financial:
    | {
        computable: true
        debt_ratio: number
        cash_securities_ratio: number
        impermissible_income_pct: number
        verdict: 'PASS' | 'CONDITIONAL' | 'FAIL'
        purification_pct: number
        market_cap: number
        market_cap_basis: 'avg_36mo_x_diluted_shares' | 'current_price_x_diluted_shares'
        market_cap_months?: number
        bridge_source_fiscal_year?: number
        /** Itemized composition of the impermissible-income input (interest, dividends, model residual). */
        impermissible_income_lines?: ImpermissibleIncomeLine[]
      }
    | undefined
  // HARNESS-OWNED impermissible income: no filing discloses an "impermissible income" line, so the pass
  // honestly returns null for nearly every ticker — which left the deep screen permanently UNDETERMINED.
  // The deterministic AAOIFI-computable components are the ITEMIZED XBRL lines (interest income,
  // dividend income, cash-instrument investment income — fundamentals.latest_annual.
  // impermissible_income_lines); their sum is the harness figure. Precedence: a pass null falls back to
  // the XBRL total; when BOTH are numeric the CONSERVATIVE max wins (the model may quantify
  // prohibited-segment revenue beyond interest/dividends, but may never silently undercount below the
  // disclosed components — purification errs high, never low).
  const xbrlImpermissibleLines = fundamentals?.latest_annual?.impermissible_income_lines
  const xbrlImpermissibleTotal =
    xbrlImpermissibleLines !== undefined && xbrlImpermissibleLines.length > 0
      ? xbrlImpermissibleLines.reduce((sum, line) => sum + line.amount_musd, 0)
      : undefined
  const modelImpermissible = shariahJudgment?.impermissible_income
  const effectiveImpermissibleIncome: number | null =
    modelImpermissible === undefined ? null
    : modelImpermissible === null ? (xbrlImpermissibleTotal ?? null)
    : xbrlImpermissibleTotal !== undefined ? Math.max(modelImpermissible, xbrlImpermissibleTotal)
    : modelImpermissible
  const impermissibleIncomeFromXbrl =
    xbrlImpermissibleTotal !== undefined
    && shariahJudgment !== undefined
    && effectiveImpermissibleIncome === xbrlImpermissibleTotal
    && modelImpermissible !== xbrlImpermissibleTotal
  // The SHOWN composition — every line that makes up the effective figure, so the dossier itemizes it
  // (interest income, dividend income, etc.). When the model's larger figure won the conservative max,
  // the excess over the disclosed components is shown as an explicit model-residual line (the total
  // always equals the sum of its shown lines).
  const impermissibleIncomeShownLines: ImpermissibleIncomeLine[] | undefined = (() => {
    if (effectiveImpermissibleIncome === null || shariahJudgment === undefined) return undefined
    if (xbrlImpermissibleLines !== undefined && xbrlImpermissibleTotal !== undefined && xbrlImpermissibleLines.length > 0) {
      if (effectiveImpermissibleIncome === xbrlImpermissibleTotal) return xbrlImpermissibleLines
      return [
        ...xbrlImpermissibleLines,
        {
          concept: 'model_judgment',
          label: 'model-quantified additional impermissible income (beyond disclosed interest/dividends)',
          amount_musd: effectiveImpermissibleIncome - xbrlImpermissibleTotal,
        },
      ]
    }
    if (effectiveImpermissibleIncome > 0) {
      return [{ concept: 'model_judgment', label: 'model-quantified impermissible income', amount_musd: effectiveImpermissibleIncome }]
    }
    return undefined // affirmatively-verified zero — nothing to itemize
  })()
  // FAIL-CLOSED on UNDETERMINED impermissible income. The pass emits impermissible_income = null when it
  // could NOT extract / the filing does not separately disclose a quantified impermissible-income line.
  // That is a DETERMINED-AS-UNDETERMINED answer (not an omission) — the harness must NOT compute a clean
  // 0% purification from it (the compliance fail-OPEN bug). Reached only when the XBRL fallback is ALSO
  // absent: it flows to computeShariahFinancialRatios as null → computable:false → shariah_financial
  // stays undefined → the verdict is UNDETERMINED, never a silent 0%/COMPLIANT.
  const impermissibleIncomeUndetermined =
    shariahJudgment !== undefined && effectiveImpermissibleIncome === null
  // When EDGAR + market cap + the Shariah overlay are all present but the ratios still come back
  // not-computable (e.g. missing revenue → divide-by-zero), capture WHY so the genuinely-not-computable
  // branch surfaces a visible shariah_ratios_unverified flag (the dogfood had NO flag here).
  let shariahRatioNotComputableReason: string | undefined
  if (
    fundamentals?.latest_annual !== undefined
    && market_cap !== undefined
    && shariahJudgment !== undefined
  ) {
    const la = fundamentals.latest_annual
    // Currency-normalize: fundamentals are in the filer's reporting currency (DKK for a 20-F filer) but
    // market_cap is in market_cap_currency (USD for a US-listed ADR). The AAOIFI ratios are dimensionless,
    // so convert the ONE mismatched number — market_cap — into the reporting currency. Fail-closed: if the
    // currencies differ and we cannot get a rate, leave the verdict UNDETERMINED rather than mix currencies.
    let market_cap_for_ratios: number | undefined = market_cap
    if (la.currency !== market_cap_currency) {
      // The market_cap is in market_cap_currency (typically USD for an ADR). fetchFxRateToUsd returns the
      // multiplier: 1 unit of `la.currency` → USD. Dividing the USD market cap by that rate converts it
      // into the filer's reporting currency (e.g. USD/DKK_per_USD = DKK).
      const usdRate = market_cap_currency === 'USD' ? await resolveFxRateValue(la.currency, deps) : undefined
      market_cap_for_ratios = usdRate === undefined ? undefined : marketCapInReportingCurrency(market_cap, la.currency, usdRate)
    }
    // Fail-closed guard: if FX conversion failed (currencies differ but rate unavailable), do not mix
    // currencies — leave the ratios not-computable so the caller surfaces UNDETERMINED.
    if (market_cap_for_ratios === undefined) {
      shariahRatioNotComputableReason = 'currency_conversion_unavailable'
    } else {
      // market_cap_for_ratios is narrowed to number here — TypeScript can see it is defined.
      const ratios = computeShariahFinancialRatios({
        // Missing interest-bearing debt / cash → treated as 0 (a near-zero-debt firm legitimately has a
        // 0% debt ratio, not NaN → not-computable). Revenue + market cap are the only required inputs.
        interest_bearing_debt: la.total_debt_musd,
        cash_and_securities: la.cash_and_securities_musd,
        total_revenue: la.revenue_musd,
        market_cap: market_cap_for_ratios,
        impermissible_income: effectiveImpermissibleIncome,
      })
      if (ratios.computable) {
        shariah_financial = {
          computable: true,
          debt_ratio: ratios.debt_ratio,
          cash_securities_ratio: ratios.cash_securities_ratio,
          impermissible_income_pct: ratios.impermissible_income_pct,
          verdict: ratios.verdict,
          purification_pct: ratios.purification_pct,
          market_cap: market_cap_for_ratios,
          market_cap_basis,
          ...(avgMarketCap !== undefined ? { market_cap_months: avgMarketCap.months } : {}),
          bridge_source_fiscal_year: la.fiscal_year,
          ...(impermissibleIncomeShownLines !== undefined ? { impermissible_income_lines: impermissibleIncomeShownLines } : {}),
        }
      } else {
        shariahRatioNotComputableReason = ratios.reason
      }
    }
  }

  // Visible degradation: the model omitted the SHARIAH judgment overlay (sector_status +
  // impermissible_income), so the harness could NOT recompute the AAOIFI debt/cash/impermissible ratios
  // and fell back to the lane (quick-screen) verdict. Surface it rather than silently shipping a thinner
  // Shariah verdict (this is the dogfood's empty shariah_financial -> lane CONDITIONAL fallback).
  if (shariahJudgment === undefined) {
    degradedFlags.push(
      'shariah_ratios_unverified: impermissible_income_not_emitted — the model omitted the Shariah judgment '
      + 'overlay (sector_status + impermissible_income), so the harness did NOT recompute the AAOIFI '
      + 'debt/cash/impermissible ratios; the Shariah verdict fell back to the lane (quick-screen) judgment.',
    )
  } else if (impermissibleIncomeUndetermined) {
    // FAIL-CLOSED: the lane reported impermissible_income = null (undetermined — the filing does not
    // separately disclose / it could not be quantified). The Shariah verdict is UNDETERMINED, NOT a
    // clean 0% purification. Surface it explicitly so the human knows what to obtain before treating the
    // name as compliant.
    degradedFlags.push(
      'shariah_ratios_unverified: impermissible_income_undetermined — the filing does not disclose / the '
      + 'lane could not quantify a separate impermissible-income line, so the harness did NOT compute the '
      + 'AAOIFI impermissible-income ratio. Purification CANNOT be determined; obtain the interest-income / '
      + 'prohibited-revenue figure before treating this name as clean (it is NOT 0% / fully compliant).',
    )
  } else if (impermissibleIncomeFromXbrl) {
    // PROVENANCE (not a degradation): the AAOIFI impermissible-income input came from the harness's
    // XBRL-extracted interest income (deterministic, from the same annual facts as the other ratio
    // inputs) — either the pass returned null (not separately disclosed in the narrative it saw) or its
    // figure undercut the disclosed interest income and the conservative max won. Visible so the human
    // knows the number's source; purification is computed, never silently 0%.
    const composition = (xbrlImpermissibleLines ?? [])
      .map((line) => `${line.label} ${line.amount_musd}M (${line.concept})`)
      .join(' + ')
    degradedFlags.push(
      `shariah_impermissible_income_xbrl: the impermissible-income input (${effectiveImpermissibleIncome}M `
      + `= ${composition}) is the harness-extracted XBRL composition of the latest annual facts — the `
      + 'deterministic AAOIFI components. The purification % is computed from it; verify the lines '
      + 'against the filing\'s investment-income note if precision matters.',
    )
  } else if (
    market_cap === undefined
    && fundamentals?.latest_annual !== undefined
    && shariah_financial === undefined
  ) {
    // The ONLY missing AAOIFI input is the market cap: EDGAR fundamentals + the Shariah overlay are both
    // present, but the price fetch failed (even after the single retry) so we have no market cap. Surface
    // WHY the ratios are absent — a transient feed outage, NOT a model omission (distinct from
    // impermissible_income_not_emitted above). We do NOT fabricate a market cap; still fail-closed.
    degradedFlags.push(
      'shariah_ratios_unverified: market_cap_unavailable — EDGAR fundamentals and the Shariah overlay were '
      + 'present, but the live price/market-cap fetch returned nothing (even after a retry), so the harness '
      + 'could NOT recompute the AAOIFI debt/cash ratios. No market cap was fabricated; re-run when the price '
      + 'feed recovers.',
    )
  } else if (shariahRatioNotComputableReason !== undefined) {
    // EDGAR fundamentals + market cap + the Shariah overlay were ALL present, but the AAOIFI recompute
    // still returned not-computable (a genuinely required input — revenue or market cap — was missing/
    // zero). Previously this branch surfaced NOTHING (the dogfood's silent shariah_financial: absent).
    // Surface the concrete reason so the absent ratios are visible, not silent.
    degradedFlags.push(
      `shariah_ratios_unverified: ${shariahRatioNotComputableReason} — EDGAR fundamentals and the Shariah `
      + 'overlay were present, but the harness could NOT recompute the AAOIFI debt/cash/impermissible ratios; '
      + 'the Shariah verdict fell back to the lane (quick-screen) judgment.',
    )
  }

  // ---- RELIGHTENED DECISION (R1): model proposes verdict + valuation + buy-below; harness sanity-checks ----
  // The frontier MODEL does the valuation/judgment (showing its work + citing sources). DETERMINISM is
  // reserved for arithmetic, a LIGHT valuation sanity-check (flag-only, NEVER blocks), the human-decision
  // boundary, and Shariah. The retired band/gap ENGINES (sustainableGrowthBand + requiredGrowthGap) no
  // longer DECIDE the verdict — they are deleted in R2; here we simply STOP using them.
  //
  //   buy_below            = the MODEL's proposed_buy_below (recorded VERBATIM — NOT derived from any FV).
  //   market_implied_growth = the reverse-DCF of today's price (computed above) — the crazy-detector.
  //   sanity_flags[]       = flag-only absurdity checks (SYMMETRIC: catches both an over-optimistic and an
  //                          over-pessimistic model read). NEVER blocks the verdict.
  //   in_buy_zone          = pure arithmetic: current_price <= buy_below (useful for watch re-surface).
  //
  // Verdict = the MODEL's investment_verdict, clamped ONLY by the existing cheap deterministic gates:
  // moat-gate (below wide → PASS), Shariah-FAIL → PASS/block, and RESEARCH_MORE when the required data
  // (owner-earnings / price) is missing. There is NO band-derived verdict.
  // C3 (owner-locked 2026-07-12): valuation_status is DERIVED arithmetic — the computed zones ARE the
  // status; the model's qualitative price call is retired (declared where the thresholds compute, below).

  // forward-DCF removal: the forward two-stage DCF "reference fair value" (a dollar cross-check FV at the
  // model's assumed growth) is no longer computed or surfaced — a dollar reference FV below the model's
  // buy-below read as a contradiction. The reverse-DCF market-implied growth (computed above) is the kept
  // valuation lens; the buy-below is the model's own number.

  // OWNER-LOCKED (2026-07-13): the model's ADVISORY buy price is RETIRED end-to-end — the book's
  // thresholds are arithmetic (IV × 0.70 / × 0.50), not the model's to propose. The stage no longer
  // asks for it; a legacy/replay value on the wire is tolerated by the schema and IGNORED here.

  // ---- Phase 4/E2 (owner-locked): the BOOK intrinsic value is the ONLY reference ----
  // IV = Σ discounted FCF(1..10, at the model's cited growth) + discounted(FCF10 × industry exit
  // multiple) + cash − debt, per share (all in the USD/listed-share frame via fxFactor). FCF0 = the
  // latest EDGAR year with CFO − capex computable (T0). The exit multiple is the STAGE's judged
  // industry P/FCF — cite-checked, clamped to [8, 20], conservative 12× fallback. When FCF is
  // unavailable the dossier is honestly UNPRICED (fail-closed) — the OE fallback is retired.
  const fcfValuation = (moat_passes_gate
    && shares_valid
    && fcfMusdUsd !== undefined
    && fcfMusdUsd > 0
    && headline_growth !== undefined)
    ? fcfIntrinsicValuePerShare({
        fcf_musd: fcfMusdUsd,
        growth: headline_growth,
        required_return,
        exit_multiple: exitResolution.multiple,
        ...(cashMusdUsd !== undefined ? { cash_musd: cashMusdUsd } : {}),
        ...(debtMusdUsd !== undefined ? { total_debt_musd: debtMusdUsd } : {}),
        shares_m: shares_outstanding,
        horizon: VALUATION_PARAMS.stage1_horizon,
      })
    : undefined
  const valuation_basis: 'fcf' | undefined = fcfValuation !== undefined ? 'fcf' : undefined
  const terminal_value_pct_of_iv = fcfValuation?.terminal_value_pct_of_iv
  if (fcfValuation !== undefined) {
    mosReferenceValue = fcfValuation.intrinsic_value_per_share
    // The dominant-uncertainty flag survives on the BOOK model: a high terminal share means most of
    // the estimate is the exit-sale guess.
    if (fcfValuation.terminal_value_pct_of_iv > buffettMungerStrategy.valuation.terminal_value_share_flag) {
      degradedFlags.push(
        `terminal_value_share_high: the terminal sale is ${(fcfValuation.terminal_value_pct_of_iv * 100).toFixed(0)}% of intrinsic `
        + `value (> ${(buffettMungerStrategy.valuation.terminal_value_share_flag * 100).toFixed(0)}%) — most of the `
        + `estimate rides on the year-10 exit multiple. Widens the effective uncertainty; audit the multiple's basis.`,
      )
    }
  }

  // Rule 7: never buy without a MINIMUM 30% margin — the operative buy threshold.
  const buy_below = (mosReferenceValue !== undefined && mosReferenceValue > 0)
    ? Number((mosReferenceValue * (1 - buffettMungerStrategy.valuation.required_margin_of_safety)).toFixed(2))
    : undefined
  // Rule 8: the LOAD-UP-THE-TRUCK threshold — a ≥50% discount marks the concentrated-sizing zone.
  const load_up_below = (mosReferenceValue !== undefined && mosReferenceValue > 0)
    ? Number((mosReferenceValue * (1 - VALUATION_PARAMS.load_up_margin)).toFixed(2))
    : undefined

  // in_buy_zone — pure arithmetic comparison on the model's number (fine; it is arithmetic, not judgment).
  // NVO dogfood (2026-07-11): computed ONLY when the moat gate passed. On a gate-failed set-aside the
  // valuation is suppressed, so NONE of the buy-below sanity rails (implied-growth, absurdity) ran —
  // surfacing "in buy zone" against an UNVETTED model number on a PASS dossier is misleading. The raw
  // proposed_buy_below stays recorded for audit; the zone judgment requires an investable case.
  const in_buy_zone = moat_passes_gate && current_price !== undefined && buy_below !== undefined
    ? current_price <= buy_below
    : undefined
  // Rule 8 zone — same gating discipline as in_buy_zone.
  const in_load_up_zone = moat_passes_gate && current_price !== undefined && load_up_below !== undefined
    ? current_price <= load_up_below
    : undefined

  // C3: the DERIVED valuation status — pure arithmetic against the computed thresholds ("code
  // computes"): in the buy zone → ATTRACTIVE; below intrinsic value but above the margin → FAIR;
  // above value → EXPENSIVE; unpriced or no live price → INSUFFICIENT_DATA.
  const valuation_status: 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA' | undefined = !moat_passes_gate
    ? undefined // the gated invariant below emits INSUFFICIENT_DATA
    : current_price === undefined || mosReferenceValue === undefined || buy_below === undefined
      ? 'INSUFFICIENT_DATA'
      : current_price <= buy_below
        ? 'ATTRACTIVE'
        : current_price <= mosReferenceValue
          ? 'FAIR'
          : 'EXPENSIVE'

  // ---- Phase 2 V2 (owner-validated 2026-07-11): the T0 MARGIN-OF-SAFETY GRADE ----
  // The model no longer grades its own margin (the joint judgment keeps ONLY the narrative — which
  // source the margin rests on and why). The GRADE is arithmetic: the buy-below's discount to the
  // conservative reference value (min(internal DCF FV, 18× OE)) measured against the UNIFORM required
  // margin (F.13: never moat-tiered — the moat's contribution to safety stays in the surfaced,
  // human-weighted channels). Audit-only, exactly like adequacy was: it NEVER gates the verdict.
  const requiredMos = buffettMungerStrategy.valuation.required_margin_of_safety
  // OWNER-LOCKED (2026-07-13, with the advisory price retired): the grade measures the margin
  // TODAY'S PRICE actually offers against the computed intrinsic value — (IV − price)/IV vs the
  // book's 30% bar. 'adequate' ⇔ in the buy zone by construction; the grade is the zone read in
  // margin vocabulary. Audit-only; it never gates the verdict.
  const margin_of_safety_grade = (current_price !== undefined && mosReferenceValue !== undefined && mosReferenceValue > 0)
    ? (() => {
        const discount = (mosReferenceValue - current_price) / mosReferenceValue
        const grade: 'adequate' | 'thin' | 'inadequate' =
          discount >= requiredMos ? 'adequate' : discount >= requiredMos / 2 ? 'thin' : 'inadequate'
        return {
          grade,
          price_discount_to_reference: Number(discount.toFixed(4)),
          required_margin: requiredMos,
          reference_basis: 'dcf_fair_value' as const,
        }
      })()
    : undefined


  // ---- E2: implied_exit_multiple — the exit multiple TODAY'S price demands (flag-only) ----
  // Solved directly from the BOOK model given the model's cited growth: the year-10 P/FCF a future
  // buyer must pay for today's price to work out. Flagged (below) when above the book band's ceiling.
  // Consumes assumed_growth, so it is gated on the same cite-verified signal as the headline.
  let implied_exit_multiple: number | undefined
  if (
    headline_growth !== undefined
    && current_price !== undefined
    && current_price > 0
    && fcfMusdUsd !== undefined
    && fcfMusdUsd > 0
    && shares_valid
  ) {
    const m = fcfImpliedExitMultiple({
      price_per_share: current_price,
      fcf_musd: fcfMusdUsd,
      growth: headline_growth,
      required_return,
      ...(cashMusdUsd !== undefined ? { cash_musd: cashMusdUsd } : {}),
      ...(debtMusdUsd !== undefined ? { total_debt_musd: debtMusdUsd } : {}),
      shares_m: shares_outstanding,
      horizon: VALUATION_PARAMS.stage1_horizon,
    })
    if (m !== undefined && Number.isFinite(m) && m > 0) {
      implied_exit_multiple = Math.round(m * 10) / 10
    }
  }


  // ---- sanity_flags: SYMMETRIC, flag-only absurdity detector (NEVER blocks the verdict) ----
  // It must catch BOTH an over-optimistic and an over-pessimistic model read:
  //   - market-implied growth above a sane bound (reverse-DCF above_cap / above_gdp);
  //   - status ATTRACTIVE while the market already prices implausibly-high growth (over-optimistic);
  //   - status EXPENSIVE while the market implies only modest growth (over-pessimistic — re-check);
  //   - the model's proposed_buy_below implies (reverse-DCF at that price) an absurd growth.
  // (forward-DCF removal: the old reference-FV terminal-share + reference-FV-cap-multiple sanity flags —
  // which compared against the now-removed dollar reference fair value — are dropped. The reverse-DCF +
  // exit-multiple sanity outputs below are the kept lens.)
  const sanity_flags: string[] = [...advisorySanityCarryover]
  const singleGrowthCap = buffettMungerStrategy.valuation.single_growth_cap

  // (a) MODEL-assumed growth above the forecasting-humility cap. OWNER RULE (2026-07-04): the cap
  // disciplines what the METHOD will underwrite — the model's OWN judgment — never the market-implied
  // read, which is a descriptive reverse-DCF fact about today's price (the market may imply whatever it
  // wants; price richness surfaces via the contradiction checks below and the exit-multiple bound).
  if (headline_growth !== undefined && headline_growth > singleGrowthCap) {
    sanity_flags.push(
      `sanity_assumed_growth_above_cap: the model's assumed sustainable growth ~${(headline_growth * 100).toFixed(1)}% `
      + `is above the ${(singleGrowthCap * 100).toFixed(0)}% forecasting-humility cap — growth the method would refuse `
      + `to underwrite. Verify the cited durable source before relying on the headline.`,
    )
  }

  // C3: the (d/e)+(d2) status-coherence flags are retired with the model's qualitative price call —
  // the status is now derived from the same arithmetic it used to be checked against.

  // Advisory cross-check (R1 superseded, owner-approved 2026-07-11): the model's price view vs the
  // METHOD's computed threshold — divergence >25% asks the human to reconcile.
  // OWNER-LOCKED (2026-07-13): the model's ADVISORY buy price is retired — the book's thresholds
  // are arithmetic (IV × 0.70 / × 0.50), not the model's to propose. The buy_below_divergence and
  // advisory-implies-absurd-growth flags retired with it (legacy payload keys tolerated on read).
  // (g) implied EXIT multiple absurdity — DIRECTIONAL, flag-only. Too HIGH (> the book band's 20×
  // ceiling) → the live price requires exiting at a P/FCF no defensible buyer would pay. The LOW
  // direction is fail-closed (non-computable emits nothing). Advisory only — never blocks or clamps.
  if (implied_exit_multiple !== undefined && implied_exit_multiple > exitResolution.multiple * 1.25) {
    sanity_flags.push(
      `sanity_implied_exit_multiple_high: today's price implies an exit multiple of ${implied_exit_multiple.toFixed(1)}× year-10 FCF `
      + `(well above the ${exitResolution.multiple}× the method underwrites from the named comps) — to merely earn the discount you would have to `
      + `sell at a richer multiple than the method would underwrite. Treat the price as rich; re-check the inputs.`,
    )
  }

  // (h) HEADLINE-GROWTH vs DEMONSTRATED HISTORY — ADVISORY, flag-only. The headline growth is the MODEL's
  // cited assumed_growth; the deterministic credited-g (effective_growth_rate, the capped demonstrated CAGR)
  // is the demonstrated-history SANITY reference. When the model assumes growth MATERIALLY above the
  // demonstrated history (assumed_growth > credited_g + a margin), surface it so the human audits whether the
  // durable cited source defends growth above what the company has actually shown. NEVER blocks the verdict —
  // the model owns the growth judgment; this only asks the question (mirrors the other §2 sanity flags).
  const DEMONSTRATED_HISTORY_MARGIN = 0.01 // 1 percentage point — avoids flagging rounding-level differences.
  if (
    moat_passes_gate
    && headline_growth !== undefined
    // Only when a demonstrated history EXISTS (the Visa data gap): a multi-class filer whose
    // companyfacts carries no consolidated share count yields zero OE/share points and a floored-to-0%
    // reference (growth_basis 'none'). Comparing the model's growth against that artificial 0% is a data
    // artifact, not evidence — the floored-g0 degraded flag already tells the "history unavailable" story.
    && growth_basis !== 'none'
    && headline_growth > demonstrated_capped + DEMONSTRATED_HISTORY_MARGIN
  ) {
    sanity_flags.push(
      `sanity_assumed_growth_above_demonstrated_history: the model assumes ~${(headline_growth * 100).toFixed(1)}% near-term `
      + `growth — above the ~${(demonstrated_capped * 100).toFixed(1)}% demonstrated FCF/share history `
      + `(credited reference). Advisory only: verify the durable cited source that defends growth above demonstrated `
      + `history before relying on the headline. The verdict is unchanged — the model owns the growth judgment.`,
    )
  }

  // HIGH safety — RESEARCH_MORE when the required data for a recordable BUY is missing. A model BUY needs
  // a usable buy-below AND a current price to be a meaningful, arithmetic-checkable buy signal; without
  // them the model's raw BUY must NOT be recorded. (Owner-earnings/price missing → no in_buy_zone.) This
  // is the cheap human-decision-boundary gate, NOT a band verdict — the sanity_flags NEVER cause a clamp.
  const sectorShariahFail = shariahJudgment?.sector_status === 'non_compliant'
    || shariah_financial?.verdict === 'FAIL'
  const buyDataUnconfirmed =
    moat_passes_gate
    && !sectorShariahFail
    && dec.analysis.investment_verdict === 'BUY'
    && (buy_below === undefined || current_price === undefined)
  const buyClampReason = buyDataUnconfirmed
    ? 'BUY not recordable: missing the data a buy signal needs (the model\'s buy-below and/or the live '
      + 'price was unavailable — owner earnings, shares, or the price fetch) — defaulting to RESEARCH_MORE.'
    : undefined

  // OWNER RULE (2026-07-04, the Visa dogfood): a model BUY at a price ABOVE the model's OWN buy-below is
  // not a recordable buy signal — "buy below $290" at a $362 price means WAIT, i.e. WATCH, by the
  // model's own arithmetic. This is pure arithmetic on the model's own numbers (exactly like in_buy_zone
  // itself), NOT a judgment override: the model's verdict + full reasoning stay recorded verbatim in the
  // decision agent's channel; only the RECORDED verdict derates to WATCH, with the reason surfaced.
  const buyOutOfBuyZone =
    moat_passes_gate
    && !sectorShariahFail
    && !buyDataUnconfirmed
    && dec.analysis.investment_verdict === 'BUY'
    && in_buy_zone === false
  const buyOutOfZoneReason = buyOutOfBuyZone && buy_below !== undefined && current_price !== undefined
    ? `buy_out_of_buy_zone: the model verdict is BUY while the live price ($${current_price.toFixed(2)}) sits `
      + `above the METHOD's computed buy threshold ($${buy_below.toFixed(2)} = reference value less the uniform `
      + `required margin). Recorded as WATCH until the price enters the zone; the BUY thesis is preserved for auditing.`
    : undefined

  // OWNER RULE (2026-07-10, the SPGI dogfood) — RETIRED 2026-07-13 with the advisory price: the
  // rail guarded the MODEL's own proposed buy price; the computed threshold (IV × 0.70) cannot
  // imply above-cap growth by construction, so there is nothing left to guard.
  const buyBelowAbsurd = false
  const buyBelowAbsurdReason: string | undefined = undefined

  // OWNER RULE (2026-07-11, Phase 3 S5): the MANAGEMENT VETO — "no price compensates for management
  // you can't trust", and the owner extended it to TALENT: a model BUY on a GROUNDED worst-tier
  // management judgment (integrity red_flag OR poor capital-allocation talent) derates to
  // RESEARCH_MORE with the reason NAMING the failed trait. Escalate-to-human, never an auto-PASS.
  // The resolver grounds these tiers only on cite-verified evidence (a hallucinated flag renders
  // "unverified" and resolves undetermined), so this clamp can never fire on an ungrounded claim.
  const managementVetoTrait: 'integrity' | 'talent' | undefined =
    MANAGEMENT_PILLAR_POLICY.integrity_veto === 'clamp'
    && moat_passes_gate
    && !sectorShariahFail
    && dec.analysis.investment_verdict === 'BUY'
      ? (managementJudgment.resolved_integrity === 'red_flag'
          ? 'integrity'
          : managementJudgment.resolved_talent === 'poor'
            ? 'talent'
            : undefined)
      : undefined
  const managementVetoReason = managementVetoTrait !== undefined
    ? `management_veto (${managementVetoTrait}): the model verdict is BUY but the management pillar resolved a GROUNDED `
      + (managementVetoTrait === 'integrity'
          ? 'integrity RED FLAG (a cite-verified high-severity finding)'
          : 'POOR capital-allocation talent (cite-verified)')
      + ' — no price compensates for management you cannot trust. Recorded as RESEARCH_MORE pending human '
      + 'verification of the cited evidence; the BUY thesis is preserved for auditing.'
    : undefined

  // OWNER RULE (2026-07-11, Phase 3 S3): "a narrowing moat is a sell signal no matter how wide it still
  // looks." A model BUY on a GROUNDED narrowing moat direction derates to WATCH with the reason surfaced.
  // The resolver only resolves 'narrowing' when >=1 direction driver cite-verified (an ungrounded or
  // omitted direction is 'undetermined' and has NO teeth here) — so this clamp can never fire on
  // hallucinated erosion. Conservative-only: BUY → WATCH; never touches WATCH/PASS/RESEARCH_MORE.
  const moatNarrowing =
    moat_passes_gate
    && !sectorShariahFail
    && !buyDataUnconfirmed
    && !buyOutOfBuyZone
    && !buyBelowAbsurd
    && dec.analysis.investment_verdict === 'BUY'
    && judgment.moat?.moat_direction === 'narrowing'
  const moatNarrowingReason = moatNarrowing
    ? 'moat_narrowing: the model verdict is BUY while the moat lane GROUNDED a narrowing moat direction — '
      + 'a narrowing moat is a sell signal no matter how wide it still looks. Recorded as WATCH (moat '
      + 'narrowing); the BUY thesis and the cited direction evidence are preserved for auditing.'
    : undefined

  // Apply the cheap deterministic gates ONLY: moat below wide → PASS; Shariah sector/financial FAIL → PASS;
  // missing buy data → RESEARCH_MORE; BUY above the model's own buy-below → WATCH. Otherwise the MODEL's
  // verdict passes through. Sanity flags NEVER gate.
  const gatedVerdict = !moat_passes_gate
    // A moat below the gate routes by WHY: an UNGROUNDED moat claim (the model reached for wide+ but the
    // cite-verified rows didn't back it / the rubric wasn't scored) is INCOMPLETE -> RESEARCH_MORE; a
    // genuinely-narrow moat (no passing claim, grounded) is set aside -> PASS.
    ? (moat_grounding_unmet ? ('RESEARCH_MORE' as const) : ('PASS' as const))
    : sectorShariahFail
      ? ('PASS' as const)
      // Founding-risk fix: the synthesis verdict is ONLY recorded when the decision agent grounded it in a
      // verified source of its OWN (Layer 1) AND its owner-earnings + assumed-growth citations verify against
      // the corpus (Layer 2). Otherwise we fail closed to RESEARCH_MORE — the model's confident
      // investment_verdict is NOT used. (The all-corpus check at I1 stays as the all-empty backstop.)
      : synthesisGroundingUnmet
        ? ('RESEARCH_MORE' as const)
        : managementVetoTrait !== undefined
          ? ('RESEARCH_MORE' as const)
          : buyDataUnconfirmed
            ? ('RESEARCH_MORE' as const)
            : buyOutOfBuyZone
              ? ('WATCH' as const)
              : buyBelowAbsurd
                ? ('WATCH' as const)
                : moatNarrowing
                  ? ('WATCH' as const)
                  : dec.analysis.investment_verdict
  const gatedReason = !moat_passes_gate
    ? (moat_grounding_unmet
        ? `${moatGroundingReason} ${dec.analysis.decision_reason}`
        : `Moat below the wide-moat gate (${moatClass}) — pass.`)
    : sectorShariahFail
      ? `Shariah ${shariahJudgment?.sector_status === 'non_compliant' ? 'sector' : 'financial'} status FAIL — pass. ${dec.analysis.decision_reason}`
      : synthesisGroundingUnmet
        ? `${synthesisGroundingReason} ${dec.analysis.decision_reason}`
        : managementVetoReason !== undefined
          ? `${managementVetoReason} ${dec.analysis.decision_reason}`
          : buyDataUnconfirmed
            ? `${buyClampReason} ${dec.analysis.decision_reason}`
            : buyOutOfZoneReason !== undefined
              ? `${buyOutOfZoneReason} ${dec.analysis.decision_reason}`
              : buyBelowAbsurdReason !== undefined
                ? `${buyBelowAbsurdReason} ${dec.analysis.decision_reason}`
                : moatNarrowingReason !== undefined
                  ? `${moatNarrowingReason} ${dec.analysis.decision_reason}`
                  : dec.analysis.decision_reason

  // D3 (owner feedback, post-B8): the JOINT margin-of-safety judgment is RETIRED. The book's mechanical
  // 30%/50% thresholds (margin_of_safety_grade, T0) own the margin; the schema strips a legacy model's
  // `margin_of_safety` emission as an unknown key, and NEW events carry no judgment/guard fields. Legacy
  // ledger events keep theirs read-only (projection tolerates by ignore).

  // ---- Project the judgment-rubric layer for the verdict/dossier (spec verdict-format additions) ----
  // rubric scores + anchor-vs-proposed tier + whether the bounded adjustment was applied + violations.
  const judgmentProjection = buildJudgmentProjection(judgment)

  // ---- Mechanism 3: base-rate burden check (deterministic flag + conservative downgrade hook) ----
  // Any case that BEATS a base rate (monopoly classification, credited g in the 4-5% band, a >20%
  // ROIC-sustained forecast, a margin-expansion claim) must carry a STRUCTURAL exceptionality
  // justification — inside-view narrative ("strong execution") is insufficient. The structural
  // evidence the synthesis supplied lives in the moat/runway rubric adjustment_evidence (cited
  // claims) + the EDGAR-anchored rubric rows. The harness FLAGS unmet burdens (base_rate_burden_unmet)
  // and surfaces them; it does NOT silently pass an unjustified exceptional claim.
  // B6: the moat exceptionality justification is now the GROUNDED moat thesis (cite-verified drivers) —
  // each grounded {advantage, citation} maps onto an {claim, citation_hash} justification. Only grounded
  // drivers count (an ungrounded driver is no justification). C2: the runway thesis is retired.
  const exceptionalityJustifications = [
    ...((judgment.moat?.moat_drivers ?? [])
      .filter((d) => d.grounded)
      .map((d) => ({ claim: d.advantage, citation_hash: d.citation }))),
  ]
  // ROIC>20% sustained signal: high reported/incremental ROIC at a wide+ moat with growth credited.
  const roicForecastGt20 =
    moat_passes_gate
    && effective_growth_rate > 0
    && (roic >= 0.20 || incremental_roic >= 0.20)
  // Margin-expansion signal from the growth narrative (a claim, not a harness computation).
  const marginExpansionClaimed = /margin[s]?\s+(expand|expansion|grow|improv|widen)/i
    .test(`${dec.analysis.growth_assumptions} ${dec.analysis.valuation_rationale}`)
  const baseRateBurden = evaluateBaseRateBurden({
    moat_class: moatClass,
    // FIX (V live find): the burden guards the growth the valuation actually UNDERWRITES — the
    // model's cite-verified headline — not the lane-argued credited rail (which a mis-parsed
    // decomposition fragment can deflate below the trigger, silently suppressing the burden).
    credited_growth_rate: headline_growth ?? demonstrated_capped,
    roic_forecast_gt_20: roicForecastGt20,
    margin_expansion_claimed: marginExpansionClaimed,
    exceptionality_justifications: exceptionalityJustifications,
  })
  const baseRateFlagsUnmet: BaseRateBurdenFlag[] = baseRateBurden.flags.filter((f) => f.status === 'unmet')

  // Conservative downgrade hook: an unmet exceptional burden lowers the synthesis confidence and adds
  // an explicit caveat so the human sees the unmet structural burden (never silently passed).
  const baseRateCaveats = baseRateFlagsUnmet.map((f) =>
    `base_rate_burden_unmet: "${f.claim}" beats the base rate (${f.base_rate_note}) without sufficient `
    + `structural justification (${f.structural_evidence_count}/${f.required_structural_evidence} structural `
    + `items). Burden: ${f.burden}. Treat as narrative until structural evidence is supplied.`,
  )

  // ---- Emit buffett_munger_analysis_drafted ----
  const analysisEvent: LedgerEventEnvelope<unknown> = {
    event_id: `evt_buffett_munger_analysis_drafted_${command.research_case_id}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    causation_id: completed.event_id,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload: {
      research_case_id: command.research_case_id,
      company_id: command.company_id,
      ticker: command.ticker,
      engine_version: ENGINE_VERSION,
      ...(engineCommit === undefined ? {} : { engine_commit: engineCommit }),
      investment_verdict: gatedVerdict,
      strategy_compliance: dec.analysis.strategy_compliance,
      shariah_status: undefined, // will be set below
      // GATED-DOSSIER INVARIANT: a moat-failed case has no vetted valuation verdict — align with the
      // set-aside precedent (INSUFFICIENT_DATA) instead of surfacing the model's unvetted status.
      valuation_status: moat_passes_gate ? valuation_status : 'INSUFFICIENT_DATA',
      next_required_action: moat_passes_gate ? dec.analysis.next_required_action : gatedReason,
      // MARGIN-OF-SAFETY AUDIT SURFACE — the model's forward-looking risk judgments (the SINGLE assumption
      // that, if wrong, breaks the thesis + the observable invalidating events). Carried verbatim from the
      // synthesis decision; required + substantive (schema + retry), deliberately NOT cite-gated.
      key_wrong_assumption: dec.analysis.key_wrong_assumption,
      thesis_break_triggers: dec.analysis.thesis_break_triggers,
      // Circle-of-competence judgment (in-competence here — the gate passed; the deep dive ran). Carried on
      // the analysis so the dossier always shows the grounded competence judgment that admitted this spend.
      circle_competence: circleJudgmentPayload,
      // Insider Form 4 summary (§3.3) — the deterministic harness computation persisted so the dossier
      // renders it model-independently (the management lane only READS it; it may or may not echo it).
      ...(insiderSummaryComputed !== undefined ? { insider_summary: insiderSummaryComputed } : {}),
      // S2 (Phase 3): the three named moat tests (T0) — pillar-2 display/judgment context.
      ...(moatTests !== undefined ? { moat_tests: moatTests } : {}),
      // B3 (Phase 4): the understand lane's seven-item one-pager (the book's Pillar 1 distillation).
      ...(onePager !== undefined ? { one_pager: onePager } : {}),
      // S6: permanent label — this analysis ran PAST a failed moat gate under the user-authored
      // override. The verdict was still gated by the late rails; the label keeps the spend honest.
      ...(command.moat_gate_override === true && !moat_passes_gate ? { moat_gate_overridden: true } : {}),
      // S5 (Phase 3): the MANAGEMENT pillar — the resolved integrity/talent judgment (grounded-only
      // teeth), the injected talent T0 observations, and the retained-earnings test. The veto flags
      // record when-and-why the rail fired so the dossier explains the clamp.
      management_judgment: {
        ...managementJudgment,
        ...(managementTalentT0 !== undefined ? { talent_t0: managementTalentT0 } : {}),
        ...(retainedEarnings !== undefined ? { retained_earnings: retainedEarnings } : {}),
      },
      ...(managementVetoTrait !== undefined ? { management_veto_applied: managementVetoTrait } : {}),
      ...(managementVetoReason !== undefined ? { management_veto_reason: managementVetoReason } : {}),
      // The admitting-gate block (shariah_gate, or quick_screen on a legacy resume) is added below.
      valuation: {
        moat_class: moatClass,
        moat_passes_gate,
        discount_rate: discount,
        // Discount provenance (Phase 1.4 / F.2): the COMPLIANT risk-free SAVINGS rate (app-config or the
        // config default) + the uniform equity premium. basis 'compliant_savings' when sourced from the
        // threaded app-config savings rate; 'config_default' when failed closed to savings_rate_default.
        // Phase 4: the discount is the REQUIRED RETURN (flat 15% default, user setting) — provenance
        // records which. (Legacy events carry risk_free_rate/equity_premium; the projection tolerates both.)
        discount_inputs: {
          required_return,
          required_return_basis: required_return_from_config ? 'setting' : 'book_default',
        },
        growth_assumptions: dec.analysis.growth_assumptions,
        // HEADLINE growth = the MODEL's cite-verified assumed_growth (the architecture: the model's grounded
        // judgment is the analysis). Omitted when assumed_growth is absent/ungrounded (degrade per A1 — we do
        // NOT fall back to the credited-g as the headline). The capped credited-g (demonstrated CAGR) is the
        // demonstrated_growth_reference below — a SANITY reference, never the headline.
        ...(headline_growth !== undefined ? { growth_rate: headline_growth } : {}),
        // demonstrated_growth_reference = the capped-mechanical credited growth (demonstrated owner-earnings/
        // share CAGR through the forecasting-humility cap; lane may argue lower) — DEMOTED to a demonstrated-
        // history SANITY reference. NOT the headline. An advisory sanity flag fires (above) when the model's
        // headline assumed_growth materially exceeds this.
        demonstrated_growth_reference: demonstrated_capped,
        growth_basis,
        // Phase 7 S4 — data-completeness evidence (item 11): CARRY the demonstrated-growth measure's own
        // window/points/method that the valuation already consumed (persist-only; NO new derivation). Lets
        // the data_completeness business-checklist item marshal "how deep/robust is the OE history".
        ...(demonstratedGrowthResult !== undefined
          ? {
              growth_window_years: demonstratedGrowthResult.window_years,
              growth_points_used: demonstratedGrowthResult.points_used,
              growth_method: demonstratedGrowthResult.method,
            }
          : {}),
        ...(growthResult.above_gdp ? { growth_above_gdp: true } : {}),
        ...(growthResult.cap_binds ? { growth_cap_binds: true } : {}),
        roic,
        incremental_roic,
        incremental_roic_basis,
        reinvestment_rate,
        // E2: the T0 FCF basis provenance (replaces the owner-earnings bridge) + the factual
        // capex-vs-D&A reinvestment-mix note (no maintenance-capex proxy anywhere).
        ...(fcfBasis !== undefined ? { fcf_basis: fcfBasis } : {}),
        // OPTION C provenance: the diluted count was recovered from the annual report's inline XBRL
        // (a per-class filer whose share facts companyfacts drops) — labeled, never silent.
        ...(edgarAnnual?.diluted_shares_source !== undefined ? { share_count_source: edgarAnnual.diluted_shares_source } : {}),
        capex_vs_da: capexVsDa,
        // Phase 2 V3: the deterministic foreign-filer conversion provenance (reporting→USD × ADR ratio).
        ...(fxConversion !== undefined ? { fx_conversion: fxConversion } : {}),
        ...(valuationCaveats.length > 0 ? { valuation_caveats: valuationCaveats } : {}),
        // Visible degraded flags: each OPTIONAL structured field the model omitted (rubric, Shariah
        // overlay, growth inputs) is recorded here so the silent skips the live dogfood exposed are SEEN.
        ...(degradedFlags.length > 0 ? { degraded_flags: degradedFlags } : {}),
        // Founding-risk fix: a visible boolean flag (+ the human-readable reason carried in degraded_flags)
        // marking that the decision agent's verdict/valuation was NOT grounded in a verified source of its
        // own → the verdict was routed to RESEARCH_MORE. Projected + displayed near the verdict.
        ...(synthesisGroundingUnmet ? { synthesis_grounding_unmet: true } : {}),
        ...(synthesisGroundingReason !== undefined ? { synthesis_grounding_reason: synthesisGroundingReason } : {}),
        // moat_grounding_unmet (+ reason): the moat gate failed because the moat claim was UNGROUNDED
        // (vs genuinely narrow) — verdict routed to RESEARCH_MORE. Surfaced like synthesis_grounding_unmet.
        ...(moat_grounding_unmet ? { moat_grounding_unmet: true } : {}),
        ...(moatGroundingReason !== undefined ? { moat_grounding_reason: moatGroundingReason } : {}),
        // forward-DCF removal: fair_value_per_share / reference_fair_value / fair_value_range /
        // fair_value_range_basis / valuation_cap_binding (the dollar forward two-stage DCF "reference fair
        // value" and its band) are NO LONGER emitted — a dollar reference FV below the model's buy-below read
        // as a contradiction. implied_multiple (a ratio derived from the internal forward FV) is kept, as are
        // the reverse-DCF market_implied_growth + implied_exit_multiple — the kept valuation lens.
        ...(terminal_value_pct_of_iv !== undefined ? { terminal_value_pct_of_iv } : {}),
        // RELIGHTENED DECISION (R1): buy_price_per_share is the MODEL's proposed_buy_below (recorded
        // verbatim — NOT a derived FV). GATED-DOSSIER INVARIANT (owner, 2026-07-11): on a moat-FAILED
        // case the buy-below was never vetted (the implied-growth/absurdity rails only run for
        // investable names), so it must NOT be emitted as a first-class judgment — it moves into the
        // explicitly-labeled unvetted_model_proposals audit block instead. Either the pipeline ran and
        // the numbers are vetted, or the dossier says GATED everywhere — never a mix.
        ...(moat_passes_gate && buy_below !== undefined ? { buy_price_per_share: buy_below, proposed_buy_below: buy_below } : {}),
        // E2: the BOOK intrinsic value per share is now surfaced first-class — it is the computed
        // reference the whole method margins off (and the sign-off freeze snapshots it verbatim).
        ...(moat_passes_gate && fcfValuation !== undefined ? { intrinsic_value_per_share: Number(fcfValuation.intrinsic_value_per_share.toFixed(2)) } : {}),
        // OWNER-LOCKED (2026-07-13): model_proposed_buy_below is RETIRED (legacy payloads keep the
        // key; the projection/display tolerate it). The thresholds are arithmetic only.
        // Phase 2: the near-term growth TODAY'S PRICE implies (reverse-DCF) — the crazy-detector. Omitted
        // when no price.
        ...(market_implied_growth !== undefined ? { market_implied_growth } : {}),
        // RELIGHTENED DECISION (R1) — the deterministic sanity layer (flag-only, NEVER blocks the verdict):
        //   in_buy_zone          = pure arithmetic current_price <= buy_below;
        //   sanity_flags[]       = SYMMETRIC absurdity flags (over-optimistic + over-pessimistic catches);
        //   valuation_reasoning  = the MODEL's cited valuation basis (it shows its work).
        ...(in_buy_zone !== undefined ? { in_buy_zone } : {}),
        // Phase 4 (book alignment): the rule-8 LOAD-UP threshold/zone + the valuation basis + the
        // resolved industry exit multiple (clamped, provenance-labeled).
        ...(moat_passes_gate && load_up_below !== undefined ? { load_up_below } : {}),
        ...(in_load_up_zone !== undefined ? { in_load_up_zone } : {}),
        ...(valuation_basis !== undefined ? { valuation_basis } : {}),
        ...(moat_passes_gate && fcfValuation !== undefined
          ? {
              exit_multiple_used: exitResolution.multiple,
              exit_multiple_source: exitResolution.source,
              ...(exitProposed?.basis_note !== undefined ? { exit_multiple_basis_note: exitProposed.basis_note } : {}),
              // Auditability: the model's STRUCTURED comps + the median the harness checked against —
              // the ledger proves the self-consistency check ran (a silent pass is not auditable).
              ...(exitProposed?.comps !== undefined && exitProposed.comps.length > 0 ? { exit_multiple_comps: exitProposed.comps } : {}),
              ...(exitCompsMedian !== undefined ? { exit_multiple_comps_median: exitCompsMedian } : {}),
            }
          : {}),
        // Phase 2 V2: the T0-computed margin-of-safety grade (audit-only; never gates).
        ...(margin_of_safety_grade !== undefined ? { margin_of_safety_grade } : {}),
        // implied_exit_multiple = current price / forward owner earnings (OE grown to the explicit horizon at
        // the MODEL's assumed growth; no discount-compounding factor) — the exit P/OE the live price requires;
        // a flag-only §2 sanity output (see the inline derivation above).
        ...(implied_exit_multiple !== undefined ? { implied_exit_multiple } : {}),
        ...(sanity_flags.length > 0 ? { sanity_flags } : {}),
        // E2: owner_earnings_basis is retired from the stage — the model judges growth + the exit
        // multiple; the harness owns the FCF basis (fcf_basis above, T0).
        ...(valuationReasoning !== undefined
          ? {
              valuation_reasoning: {
                assumed_growth: valuationReasoning.assumed_growth,
                assumed_growth_rationale: valuationReasoning.assumed_growth_rationale,
                ...(valuationReasoning.discount_rationale !== undefined ? { discount_rationale: valuationReasoning.discount_rationale } : {}),
              },
            }
          : {}),
        value_basis: 'two_stage_dcf',
        // Judgment-objectivity layer (Mechanisms 1+2): rubric scores + anchor-vs-proposed tier per axis.
        ...(judgmentProjection !== undefined ? { judgment: judgmentProjection } : {}),
        // Mechanism 3: base-rate burden flags (base_rate_burden_unmet) for claims that beat a base rate.
        ...(baseRateBurden.flags.length > 0
          ? {
              base_rate_burden: {
                version: BASE_RATES.version,
                unmet_count: baseRateBurden.unmet_count,
                flags: baseRateBurden.flags.map((f) => ({
                  base_rate_id: f.base_rate_id,
                  claim: f.claim,
                  status: f.status,
                  required_structural_evidence: f.required_structural_evidence,
                  structural_evidence_count: f.structural_evidence_count,
                })),
              },
            }
          : {}),
      },
      // Harness-computed AAOIFI Shariah financial ratios (re-verifying the model). Absent when not
      // computable (EDGAR/market-cap/impermissible-income missing) — caller falls back to lane verdict.
      ...(shariah_financial !== undefined ? { shariah_financial } : {}),
      ...(shariahJudgment !== undefined ? { shariah_sector_status: shariahJudgment.sector_status } : {}),
      // FAIL-CLOSED marker: the lane reported impermissible_income = null (undetermined), so the AAOIFI
      // impermissible ratio + purification % could NOT be computed. Surfaced so the dossier renders the
      // UNDETERMINED state honestly ("purification cannot be determined"), never a falsely-clean 0%.
      ...(impermissibleIncomeUndetermined ? { shariah_impermissible_income_undetermined: true } : {}),
      // FAIL-CLOSED marker: the focused Shariah-reasoning PASS did not ground (schema-invalid response,
      // unverified citation, or timeout), so the deep compliance re-verification did NOT run. Rides ALONGSIDE
      // the (quick-screen) verdict — it never flips a genuinely-computed verdict; the dossier renders a calm
      // "compliance not deep-verified this run" caveat so a human does not read a falsely-confident COMPLIANT.
      ...(shariahDeepScreenIncomplete ? { shariah_deep_screen_incomplete: true } : {}),
      // Mechanism 6: source-discipline summary — which lane-proposed sources the per-lane whitelist
      // rejected (count + per-lane/reason). Surfaced so a starved lane is visible, never hidden.
      ...(sourcePolicyRejections.length > 0
        ? {
            source_discipline: {
              version: SOURCE_POLICY.version,
              rejected_count: sourcePolicyRejections.length,
              rejections: sourcePolicyRejections.map((r) => ({
                lane: r.lane,
                source_id: r.source_id,
                category: r.category,
                reason: r.reason,
              })),
            },
          }
        : {}),
      // E1: the inversion layer — the case argued against itself (cite-checked objection + the
      // consensus/social-proof read). Persisted on the inversion layer; no answer-or-downgrade machinery.
      inversion: inversionLayer,
      // model-tiering-spec dual-model cross-check (moat + Shariah sector only). Present only when a
      // distinct cross-check model was configured for that dimension (off by default). Records the two
      // models + agreement; disagreement also raised requires_human_escalation in open_questions above.
      ...((moatCrossCheckLayer !== undefined || shariahCrossCheckLayer !== undefined)
        ? {
            dual_model_crosscheck: {
              ...(moatCrossCheckLayer !== undefined ? { moat_class: moatCrossCheckLayer } : {}),
              ...(shariahCrossCheckLayer !== undefined ? { shariah_sector_status: shariahCrossCheckLayer } : {}),
            },
          }
        : {}),
    },
    source_ids: allVerified,
    created_at: new Date().toISOString(),
    schema_version: 1,
    idempotency_key: `analysis:${command.research_case_id}:v1`,
  }

  // Resolve the FALLBACK proposed Shariah status from the ledger gate event. Since this function can
  // be called independently (the approval-resume path), we re-read the event by gate_event_id. Two
  // shapes exist: the front shariah_gate_judged event carries `sector_status`
  // (compliant/conditional/non_compliant/undetermined); a LEGACY pending run's quick_screen_drafted
  // event carries `shariah_status` (COMPLIANT/…/PENDING). Both map conservatively (unknown →
  // CONDITIONAL, never a fabricated COMPLIANT).
  const gateEventFromStore = (await store.list()).find(
    (e) => e.event_id === command.gate_event_id,
  )
  const gateEventPayload = gateEventFromStore?.payload as Record<string, unknown> | undefined
  const gateSectorStatus = gateEventPayload?.['sector_status'] as 'compliant' | 'conditional' | 'non_compliant' | 'undetermined' | undefined
  const rawShariahStatus = gateEventPayload?.['shariah_status'] as 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'PENDING' | undefined
  const laneShariahStatus: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN' =
    gateSectorStatus !== undefined
      ? (gateSectorStatus === 'compliant' ? 'COMPLIANT'
        : gateSectorStatus === 'non_compliant' ? 'NON_COMPLIANT'
        : 'CONDITIONAL')
      : rawShariahStatus === 'COMPLIANT' ? 'COMPLIANT'
      : rawShariahStatus === 'NON_COMPLIANT' ? 'NON_COMPLIANT'
      : rawShariahStatus === 'CONDITIONAL' ? 'CONDITIONAL'
      : 'CONDITIONAL'

  // Recorded Shariah status: SECTOR is a hard stop independent of the financial ratios — a
  // non_compliant sector forces NON_COMPLIANT even when the balance-sheet ratios pass. Otherwise the
  // HARNESS-computed financial verdict (when computable) supersedes the lane's proposed status,
  // re-verifying the model. When not computable, we fall back to the lane-proposed status.
  const sectorHardStop = shariahJudgment?.sector_status === 'non_compliant'
  const harnessFinancialStatus: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | undefined =
    shariah_financial !== undefined
      ? (shariah_financial.verdict === 'PASS' ? 'COMPLIANT'
        : shariah_financial.verdict === 'CONDITIONAL' ? 'CONDITIONAL'
        : 'NON_COMPLIANT')
      : undefined
  // FAIL-CLOSED: a non_compliant SECTOR is a hard stop (NON_COMPLIANT). Otherwise, when impermissible
  // income is UNDETERMINED (lane returned null) the status is a DISTINCT 'UNDETERMINED' — NOT a clean
  // COMPLIANT and NOT a silent 0% purification; purification cannot be determined until the impermissible-
  // income figure is obtained. Only with a real (computable) verdict does the harness status supersede the
  // lane's proposed (quick-screen) status.
  const analysisShariahStatusForPhase: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNDETERMINED' | 'UNKNOWN' =
    sectorHardStop ? 'NON_COMPLIANT'
    : impermissibleIncomeUndetermined ? 'UNDETERMINED'
    : harnessFinancialStatus ?? laneShariahStatus

  // Carry the admitting gate's judgment on the analysis. Current runs record the front-gate summary
  // under `shariah_gate`; a LEGACY approval-resume (gate_event_id → an old quick_screen_drafted
  // event) still records the historical `quick_screen` sub-object so old dossiers stay coherent.
  const gateOrQuickScreenBlock = gateSectorStatus !== undefined
    ? {
        shariah_gate: {
          sector_status: gateSectorStatus,
          ...(gateEventPayload?.['sector_reasoning'] === undefined ? {} : { sector_reasoning: gateEventPayload['sector_reasoning'] }),
          ...(gateEventPayload?.['ratio_verdict'] === undefined ? {} : { ratio_verdict: gateEventPayload['ratio_verdict'] }),
          ...(gateEventPayload?.['gate_incomplete'] === true ? { gate_incomplete: true } : {}),
          reason: String(gateEventPayload?.['reason'] ?? ''),
        },
      }
    : {
        quick_screen: {
          summary: String(gateEventPayload?.['summary'] ?? ''),
          business_quality: String(gateEventPayload?.['business_quality'] ?? ''),
          moat: String(gateEventPayload?.['moat'] ?? ''),
          management_capital_allocation: String(gateEventPayload?.['management_capital_allocation'] ?? ''),
          financial_quality: String(gateEventPayload?.['financial_quality'] ?? ''),
          valuation_sanity: String(gateEventPayload?.['valuation_sanity'] ?? ''),
          screening_result: String(gateEventPayload?.['screening_result'] ?? ''),
          confidence: String(gateEventPayload?.['confidence'] ?? ''),
        },
      }
  const analysisFinalPayload = {
    ...(analysisEvent.payload as Record<string, unknown>),
    shariah_status: analysisShariahStatusForPhase,
    ...gateOrQuickScreenBlock,
  }

  const analysis = await store.append({ ...analysisEvent, payload: analysisFinalPayload })

  // E1: no answer-or-downgrade machinery — the inversion is recorded on the payload; the decision
  // reason carries no red-team annotation.
  const redTeamReasonNote = ''

  const decision = await draftDecision(store, {
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    decision: gatedVerdict,
    reason: gatedReason + redTeamReasonNote,
    thesis_summary: dec.analysis.thesis_summary,
    evidence_summary: dec.analysis.evidence_summary,
    valuation_rationale: (moat_passes_gate ? dec.analysis.valuation_rationale : `Moat gate rejected: ${moatClass} is below the minimum investable moat (wide). No buy price computed.`)
      + (valuationCaveats.length > 0 ? ` ${valuationCaveats.join(' ')}` : ''),
    shariah_rationale: dec.analysis.shariah_rationale,
    risks: dec.analysis.risks,
    // Mechanism 3 conservative hook: unmet base-rate burdens are surfaced as open questions so an
    // exceptional claim lacking structural evidence is never silently passed to the human.
    // Mechanism 5 conservative hook: an unaddressed red-team objection (or an incomplete red-team pass)
    // is appended to open_questions — silence is not an option; the gap is always surfaced.
    // Degraded-field hook: every OPTIONAL structured field the model omitted (rubric, Shariah overlay,
    // g=0 floor) is appended too, so the human sees exactly what the model failed to provide.
    open_questions: [
      ...dec.analysis.open_questions,
      // HIGH safety: a model BUY clamped to RESEARCH_MORE because no buy band was computable is always
      // surfaced — the human sees exactly why the BUY was not recorded.
      ...(buyClampReason !== undefined ? [buyClampReason] : []),
      // OWNER RULE: a model BUY derated to WATCH because the price is above the model's OWN buy-below is
      // always surfaced — the human sees the BUY thesis is intact and exactly what price re-arms it.
      ...(buyOutOfZoneReason !== undefined ? [buyOutOfZoneReason] : []),
      // OWNER RULE (SPGI dogfood): a model BUY derated to WATCH because its OWN buy-below already prices
      // in above-cap growth is always surfaced — the human sees why the buy price itself is not credible.
      ...(buyBelowAbsurdReason !== undefined ? [buyBelowAbsurdReason] : []),
      // OWNER RULE (Phase 3 S3): a model BUY derated to WATCH on a GROUNDED narrowing moat is always
      // surfaced — the human sees the sell-signal principle applied and the cited direction evidence.
      ...(moatNarrowingReason !== undefined ? [moatNarrowingReason] : []),
      // OWNER RULE (Phase 3 S5): a model BUY clamped by the MANAGEMENT VETO is always surfaced —
      // the human sees WHICH trait failed (integrity vs talent) and what evidence to verify.
      ...(managementVetoReason !== undefined ? [managementVetoReason] : []),
      ...baseRateCaveats,
      ...degradedFlags,
      // Dual-model cross-check disagreements → automatic human escalation (conservative answer holds).
      ...crossCheckOpenQuestions,
      ...(inversionOpenQuestion !== undefined ? [inversionOpenQuestion] : []),
    ],
    causation_id: completed.event_id,
    source_ids: allVerified,
    idempotency_key: `decision:${command.research_case_id}:v1`,
  })

  // ---- Persist source bundle ----
  const captured = [...accumulated.values()]
  if (captured.length > 0) {
    await ingestManualSourceBundle({
      source_ledger_path: command.source_ledger_path,
      research_case_id: command.research_case_id,
      ticker: command.ticker,
      strategy_id: command.strategy_id,
      provider_id: provider.provider_id,
      proposed_by_actor_type: 'provider',
      proposed_by_actor_id: provider.provider_id,
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'research_workflow',
      sources: toLedgerSourceInputs(captured, command.research_case_id),
    })
  }

  return {
    deep_dive: { queued, started, findings, synthesis, completed },
    analysis,
    decision,
  }
}
