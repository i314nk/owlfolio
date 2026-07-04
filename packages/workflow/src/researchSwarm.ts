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
  sanitizeMaintenanceCapex,
  sanitizeReinvestmentRate,
  sanitizeWorkingCapitalChange,
  anchorNetIncomeToEdgar,
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
import { computeIncrementalRoic, demonstratedOwnerEarningsGrowth, estimateMaintenanceCapex, ownerEarningsVsFcfDiagnostic, selectLatestAnnualFiling, selectLatestProxyFiling, selectRecentReadableFilings, type Fundamentals, type ImpermissibleIncomeLine, type SecEdgarDeps } from './secEdgar'
import { resolveFundamentalsForTicker } from './fundamentalsProvider'
import { evaluateBaseRateBurden, type BaseRateBurdenFlag } from './baseRateBurden'
import { BASE_RATES } from '@owlfolio/strategies/baseRates'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'
import { SOURCE_POLICY } from '@owlfolio/strategies/sourcePolicy'
import { createResearchCase, draftDecision } from './researchWorkflow'
import {
  buffettMungerDeepDiveLanes,
  draftQuickScreen,
  queueDeepDive,
  startDeepDive,
  recordSpecialistFinding,
  draftDeepDiveSynthesis,
  completeDeepDive,
} from './strategyResearchPipeline'
import { ingestManualSourceBundle, type ManualUrlEvidenceSourceInput } from './sourceLedger'
import { resolveResearchStrategyRef } from './researchStrategyRef'
import { buffettMungerStrategy, creditedGrowth, discountRate, moatPassesGate, ownerEarningsAtHorizon, stage1HorizonForMoat, terminalGrowthForMoat, twoStageValuation } from '@owlfolio/strategies/buffettMunger'
import { computeShariahFinancialRatios } from '@owlfolio/strategies/shariahFinancialRatios'
import { marketImpliedGrowth } from '@owlfolio/strategies/reverseDcf'
// NOTE (R1): sustainableGrowthBand + requiredGrowthGap are no longer imported here — the relightened
// decision stopped using the band/gap engines (they are deleted entirely in R2). The model now proposes
// the verdict + valuation + buy-below; the deterministic side only sanity-checks + applies the cheap gates.
import { fetchAverageMarketCap, resolveCurrentPrice, type AverageMarketCapResult, type MarketDataDeps, type PriceQuote } from './marketData'
import { runRedTeamPass, runRedTeamResponsePass, buildRedTeamLayer, type RedTeamLaneDigest, type RedTeamResult } from './redTeamPass'
import { runValuationReasoningPass, type ValuationReasoning } from './valuationReasoningPass'
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
  QuickScreenAgentSchema,
  LaneAgentSchema,
  MoatLaneSchema,
  DecisionAgentSchema,
  MoatCrossCheckSchema,
  ShariahCrossCheckSchema,
  CircleCompetenceSchema,
  AGENT_TIMEOUT_MS,
  MOAT_RUBRIC_PROMPT,
  CIRCLE_COMPETENCE_PROMPT,
  RISKS_RECENCY_NOTE,
  PRIMARY_FILING_LANES,
} from './researchSwarmSchemas'
// Deterministic harness compute (judgment-tier resolution, projection builders, OE-bridge filing block,
// maintenance-capex tier fraction) lives in a pure-compute module. Re-exported below for existing
// importers (the researchSwarm test imports resolveJudgmentTiers + the judgment types from here).
import {
  maintenanceFractionForTier,
  parseLaneArguedGrowth,
  resolveJudgmentTiers,
  buildJudgmentProjection,
  resolveEngineCommit,
  buildPrimaryFilingBlock,
  buildProxyBlock,
  buildRecentFilingsBlock,
  buildPreVerifiedSourcesBlock,
  buildQuickScreenFilingBlock,
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
  /** Visible per-lane degradation: the lane omitted its REQUIRED judgment block after schema-retry. */
  judgment_retry_degraded?: string
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
  /** Controls deep-dive gating.
   *  'automatic' (default): quick screen → deep dive → decision in one run.
   *  'review': quick screen → pause (deep_dive_approval_pending) → return without running deep dive.
   */
  quick_screen_approval?: 'automatic' | 'review'
  /** model-tiering: optional per-role provider/model overrides (registry). Omitted = single-provider default. */
  model_overrides?: Partial<Record<ModelRoleId, ModelRoleOverride>>
  /**
   * model-tiering: the env source the registry reads `OWLFOLIO_MODEL_ROLE_<ROLE>` from. The web/worker
   * build this from the UI-managed env FILE merged over process.env (file wins), so file-configured
   * tiers take effect. Omitted = `process.env` (the historical default — resolver behavior unchanged).
   */
  model_role_env?: Record<string, string | undefined>
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
  /** Source ids from the quick screen — used to seed queueDeepDive */
  quick_screen_source_ids: string[]
  /** event_id of the quick_screen_drafted event — used as causation_id */
  quick_screen_event_id: string
  /**
   * F.2 — the COMPLIANT risk-free SAVINGS rate (Mudarabah expected profit, decimal) from the app-config
   * savings sleeve (`savings_expected_profit_rate`), used as the discount risk-free anchor. The SAME
   * baseline the deployment-hurdle + sizing engines use. Omitted / non-finite / non-positive → the discount
   * fails closed to `savings_rate_default` (the Treasury anchor is retired).
   */
  risk_free_rate?: number
  /** model-tiering: optional per-role provider/model overrides (registry). Omitted = single-provider default. */
  model_overrides?: Partial<Record<ModelRoleId, ModelRoleOverride>>
  /**
   * model-tiering: the env source the registry reads `OWLFOLIO_MODEL_ROLE_<ROLE>` from (env FILE merged
   * over process.env, file wins). Omitted = `process.env` (historical default).
   */
  model_role_env?: Record<string, string | undefined>
  /** Circle-gate hardening knobs (k-sample agreement + evidence floors). Absent → shared defaults. */
  circle_gate?: CircleGateSettings
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
): Promise<{ market_cap: number; months: number } | undefined> {
  const resolver = deps.resolveAverageMarketCap
    ?? (isOfflineTestMode()
      ? undefined
      : ((t: string, shares: number, d?: MarketDataDeps) => fetchAverageMarketCap({ ticker: t }, shares, undefined, d)))
  if (resolver === undefined) return undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await priceRetryBackoff()
    try {
      const result = await resolver(ticker, diluted_shares)
      if (result.available) return { market_cap: result.market_cap, months: result.months }
      // available:false — transient; retry once, then give up.
    } catch {
      // Thrown transient error — retry once, then give up.
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Helpers for mapping shariah status
// ---------------------------------------------------------------------------

function toAnalysisShariahStatus(
  rawShariahStatus: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'PENDING',
): 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN' {
  // Map qs.analysis.shariah_status (which may be 'PENDING') to the valid analysis set
  // (COMPLIANT | CONDITIONAL | NON_COMPLIANT | UNKNOWN). PENDING -> CONDITIONAL.
  if (rawShariahStatus === 'COMPLIANT') return 'COMPLIANT'
  if (rawShariahStatus === 'NON_COMPLIANT') return 'NON_COMPLIANT'
  if (rawShariahStatus === 'CONDITIONAL') return 'CONDITIONAL'
  return 'CONDITIONAL' // PENDING maps to CONDITIONAL (data available but not yet resolved)
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runStrategyResearchSwarm(
  store: SwarmStore,
  provider: Provider,
  command: RunStrategyResearchSwarmCommand,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number; maxToolCalls?: number } & FundamentalsDeps = {},
) {
  const strategyRef = resolveResearchStrategyRef(command)
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

  // ---- Quick screen agent (Shariah-first gate) ----
  // The quick screen is a two-step gate:
  //   1. Shariah compliance: if NON_COMPLIANT, reject immediately — do not run the deep dive.
  //   2. Business quality: if clearly not worth investigating, reject.
  // Only 'deep_dive_candidate' cases with non-NON_COMPLIANT Shariah status proceed to the expensive deep dive.
  let qs: GroundedAgentResult<z.infer<typeof QuickScreenAgentSchema>>
  // model-tiering: the quick screen runs on the `quick_screen` role (T2). Default = the run's provider/model.
  const quickScreenRuntime = resolveRoleRuntime('quick_screen', provider, command)

  // ---- Pre-fetch + ground the primary filing for the quick-screen grounding firewall ----
  // CRITICAL: the configured personal-local provider (`openai`) declares 'multi-step-tool-loop':
  // 'unsupported', so runGroundedAgentWithTools below takes its DEGRADED (no-tools) fallback — the model
  // cannot actually call search_filings / fetch_source. Tool-grounding alone therefore does NOT close the
  // hole on the live provider. To ground the gate on a no-tools provider (the production path), the harness
  // deterministically pre-fetches the latest ANNUAL filing, grounds it as a verified primary source, and
  // INJECTS it as a PRE-VERIFIED-SOURCES block — exactly as the circle gate (:816) and the deep-dive lanes
  // do. A loop-capable provider ALSO gets live fetch tools (the runGroundedAgentWithTools switch); a
  // no-tools provider gets grounding purely from this injection. When fundamentals do NOT resolve
  // (non-EDGAR name / EDGAR down) AND the provider has no tools, there is nothing verifiable to cite and
  // the fail-closed check below correctly fails the gate closed.
  const qsFundamentals = await resolveFundamentals(command.ticker, deps)
  let qsPrimaryFilingSourceId: string | undefined
  let qsPreVerifiedSourcesBlock: string | undefined
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
        // QUICK-SCREEN-specific block (NOT buildPreVerifiedSourcesBlock): the quick-screen schema has no
        // citation field, so a source_id must NEVER be put into proposed_sources. This block injects the
        // verified filing's id (for reference) + the harness-fetched financials (to ground the worth-it
        // read) and ends with the explicit "proposed_sources is REAL URLs only / empty [] is fine" rule.
        qsPreVerifiedSourcesBlock = buildQuickScreenFilingBlock(qsFundamentals, sourceId)
      }
    }
  }

  try {
    // GROUNDED quick screen: the gate grounds BOTH decisions (Shariah permissibility + worth-investigating)
    // in the harness-verified primary filing — the injected PRE-VERIFIED-SOURCES block (works on every
    // provider, tools or not) plus, on loop-capable providers, live search_filings / fetch_source. The
    // harness post-hoc cite-verifies the captured sources; the fail-closed check below is the firewall.
    const { degraded_no_tools: _qsDegraded, ...qsAgent } = await runGroundedAgentWithTools(quickScreenRuntime.provider, {
    run_id: `run_${command.research_case_id}_quick_screen`,
    model_id: quickScreenRuntime.model_id,
    prompt: `You are the Buffett-Munger quick-screen gate agent for ${command.ticker} (${command.company_id}). `
      + `This is a two-step gate — NOT a full analysis. Keep responses brief; the deep dive handles detail.\n\n`
      + `GROUND YOURSELF IN THE PRIMARY FILING BEFORE JUDGING — do NOT judge from your prior knowledge of `
      + `the brand. A harness-verified copy of the company's latest annual filing is provided below (see `
      + `HARNESS PRE-VERIFIED PRIMARY FILING, when present): ground BOTH gate judgments in it — STEP 1 in its `
      + `described business activities / revenue mix, STEP 2 in the harness-fetched financials shown there. `
      + `That filing is ALREADY harness-verified, so you do NOT need to fetch or propose anything to be `
      + `grounded. If grounded fetch tools are available you MAY additionally call search_filings (10-K for US `
      + `issuers, 20-F for foreign private issuers such as TSMC, 40-F for Canadian issuers) and fetch_source `
      + `to read more, but it is optional. Reading ONE primary filing is enough for this fast gate.\n\n`
      + `STEP 1 — Shariah permissibility: based on the filing's DESCRIBED business activities and revenue `
      + `mix, assess whether the company's primary business is permissible under Islamic finance principles. `
      + `If the core business is clearly haram (e.g. conventional banking, alcohol, weapons, tobacco, adult `
      + `content), set shariah_status to 'NON_COMPLIANT' and screening_result to 'reject'. If the business is `
      + `clearly halal or the status is uncertain/conditional, set shariah_status accordingly ('COMPLIANT', `
      + `'CONDITIONAL', or 'PENDING') and continue to step 2.\n\n`
      + `STEP 2 (only if not NON_COMPLIANT) — Business quality worth-investigating check, grounded in the `
      + `filing: is this company worth a deep dive under Buffett-Munger criteria? If clearly inadequate (e.g. `
      + `no durable business, chronic losses, terminal industry), set screening_result to 'reject'. Otherwise `
      + `set screening_result to 'deep_dive_candidate'.\n\n`
      + `Return a brief assessment in each field. Do NOT perform per-dimension deep analysis — that is the `
      + `deep dive's job. proposed_sources is for REAL fetched URLs ONLY — NEVER put a source_id or an `
      + `invented URL there; if you fetched no additional real URL, return proposed_sources as an empty array `
      + `[] (the pre-verified filing already grounds this gate).`
      // Inject the harness's QUICK-SCREEN-specific pre-verified filing block (financials + the empty-
      // proposed_sources rule). NOT buildPreVerifiedSourcesBlock — the quick-screen schema has no citation
      // field, so a source_id must never be routed into proposed_sources (the invalid-URL regression).
      + (qsPreVerifiedSourcesBlock ?? ''),
    timeout_ms: AGENT_TIMEOUT_MS,
    schema_name: 'BuffettMungerQuickScreen',
    }, QuickScreenAgentSchema, {
      ...(deps.ground === undefined ? {} : { ground: deps.ground }),
      ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
      ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
      ...(deps.maxToolCalls === undefined ? {} : { maxToolCalls: deps.maxToolCalls }),
    })
    void _qsDegraded
    qs = qsAgent
  } catch (error) {
    // Quick-screen tool loop failed: fail the run cleanly (no lanes ran yet) rather than throw a raw
    // provider/timeout error past the swarm boundary. The worker records this as research_run_failed.
    // (The circle gate relies on this same stage-error path — there is no bespoke retry here.)
    throw new ResearchSwarmStageError('quick_screen', error, { lanes_completed: false })
  }
  remember(qs.captured)

  // The harness pre-fetched primary filing is grounded by the harness (not the agent loop), so fold its id
  // into the gate's verified set: the model was instructed to cite it via the injected block, but on a
  // no-tools provider the harness grounding is the authoritative anchor. This is what puts the injected
  // filing id in verified_ids (→ the fail-closed firewall counts it, draftQuickScreen records it, and the
  // dossier source-count reflects it) on the production no-tools path.
  if (qsPrimaryFilingSourceId !== undefined && !qs.verified_ids.includes(qsPrimaryFilingSourceId)) {
    qs.verified_ids = [qsPrimaryFilingSourceId, ...qs.verified_ids]
  }

  // I1: fail-closed if the quick screen grounded in ZERO content-hash-verified sources — i.e. neither the
  // harness pre-fetch nor the model produced a verifiable primary source. This is the grounding firewall:
  // the gate may only proceed when its judgments are anchored to ≥1 verified source, not the training prior.
  // RESIDUAL: a non-EDGAR name (GCC/private filer EDGAR cannot resolve) on a no-tools provider has nothing
  // to ground → fails closed here. That is the correct, safe outcome, not a regression.
  if (qs.verified_ids.length === 0) {
    throw new Error(`Quick screen for ${command.ticker} produced no verifiable grounded sources (fail-closed).`)
  }

  const quickScreen = await draftQuickScreen(store, {
    research_case_id: command.research_case_id,
    quick_screen_id: `quick_${swarmSeg(command.research_case_id)}`,
    company_id: command.company_id,
    ticker: command.ticker,
    ...strategyRef,
    screening_result: qs.analysis.screening_result,
    summary: qs.analysis.summary,
    business_quality: qs.analysis.business_quality,
    moat: qs.analysis.moat,
    management_capital_allocation: qs.analysis.management_capital_allocation,
    financial_quality: qs.analysis.financial_quality,
    valuation_sanity: qs.analysis.valuation_sanity,
    shariah_status: qs.analysis.shariah_status,
    red_flags: qs.analysis.red_flags,
    confidence: qs.analysis.confidence,
    caveats: qs.analysis.caveats,
    source_ids: qs.verified_ids,
    actor_id: provider.provider_id,
    idempotency_key: `quick-screen:${command.research_case_id}:v1`,
  })

  const analysisShariahStatus = toAnalysisShariahStatus(qs.analysis.shariah_status)

  // ---- Shariah-first gate: short-circuit if rejected at quick screen ----
  // Reject if: Shariah NON_COMPLIANT OR business quality clearly inadequate (screening_result = 'reject').
  const isRejected =
    qs.analysis.screening_result === 'reject' || qs.analysis.shariah_status === 'NON_COMPLIANT'

  if (isRejected) {
    // Determine the rejection reason for the brief thesis/evidence/rationale
    const rejectionReason = qs.analysis.shariah_status === 'NON_COMPLIANT'
      ? `Rejected at quick screen: Shariah non-compliant — ${qs.analysis.summary}`
      : `Rejected at quick screen: business quality insufficient — ${qs.analysis.summary}`

    // Strategy compliance on the analysis: NON_COMPLIANT if Shariah rejected, else INSUFFICIENT_DATA
    const strategyCompliance: 'NON_COMPLIANT' | 'INSUFFICIENT_DATA' =
      qs.analysis.shariah_status === 'NON_COMPLIANT' ? 'NON_COMPLIANT' : 'INSUFFICIENT_DATA'

    const shortCircuitAnalysisEvent: LedgerEventEnvelope<unknown> = {
      event_id: `evt_buffett_munger_analysis_drafted_${command.research_case_id}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case',
      aggregate_id: command.research_case_id,
      correlation_id: command.research_case_id,
      causation_id: quickScreen.event_id,
      actor_type: 'provider',
      actor_id: provider.provider_id,
      payload: {
        research_case_id: command.research_case_id,
        company_id: command.company_id,
        ticker: command.ticker,
        engine_version: ENGINE_VERSION,
        ...(engineCommit === undefined ? {} : { engine_commit: engineCommit }),
        investment_verdict: 'PASS',
        strategy_compliance: strategyCompliance,
        shariah_status: analysisShariahStatus,
        valuation_status: 'INSUFFICIENT_DATA',
        next_required_action: 'No further research required; case rejected at quick screen.',
        quick_screen: {
          summary: qs.analysis.summary,
          business_quality: qs.analysis.business_quality,
          moat: qs.analysis.moat,
          management_capital_allocation: qs.analysis.management_capital_allocation,
          financial_quality: qs.analysis.financial_quality,
          valuation_sanity: qs.analysis.valuation_sanity,
          screening_result: qs.analysis.screening_result,
          confidence: qs.analysis.confidence,
        },
      },
      source_ids: qs.verified_ids,
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `analysis:${command.research_case_id}:v1`,
    }
    const shortCircuitAnalysis = await store.append(shortCircuitAnalysisEvent)

    const shortCircuitDecision = await draftDecision(store, {
      research_case_id: command.research_case_id,
      decision_id: command.decision_id,
      decision: 'PASS',
      reason: rejectionReason,
      thesis_summary: rejectionReason,
      evidence_summary: rejectionReason,
      valuation_rationale: 'Not assessed — case rejected at quick screen.',
      shariah_rationale: qs.analysis.summary,
      risks: qs.analysis.red_flags,
      open_questions: qs.analysis.caveats,
      causation_id: quickScreen.event_id,
      source_ids: qs.verified_ids,
      idempotency_key: `decision:${command.research_case_id}:v1`,
    })

    // Persist source bundle for the quick-screen-only captured sources
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
      quick_screen: quickScreen,
      analysis: shortCircuitAnalysis,
      decision: shortCircuitDecision,
    }
  }

  // ---- Review gate: if quick_screen_approval === 'review', pause here ----
  if ((command.quick_screen_approval ?? 'automatic') === 'review') {
    // Persist quick-screen sources before pausing
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
      causation_id: quickScreen.event_id,
      actor_type: 'system',
      actor_id: 'research_workflow',
      payload: {
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        company_id: command.company_id,
        quick_screen_source_ids: qs.verified_ids,
        quick_screen_event_id: quickScreen.event_id,
        decision_id: command.decision_id,
        source_ledger_path: command.source_ledger_path,
        strategy_id: command.strategy_id,
        model_id: command.model_id,
      },
      source_ids: qs.verified_ids,
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `deep-dive-approval-pending:${command.research_case_id}:v1`,
    }
    await store.append(pendingEvent)

    return {
      research_case: researchCase,
      quick_screen: quickScreen,
      awaiting_deep_dive_approval: true,
    }
  }

  // ---- Automatic mode: run deep dive immediately ----
  const deepDiveResult = await runResearchDeepDivePhase(store, provider, {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    strategy_id: command.strategy_id,
    ...(command.strategy_version === undefined ? {} : { strategy_version: command.strategy_version }),
    model_id: command.model_id,
    decision_id: command.decision_id,
    source_ledger_path: command.source_ledger_path,
    quick_screen_source_ids: qs.verified_ids,
    quick_screen_event_id: quickScreen.event_id,
    // model-tiering: forward per-role overrides so the deep-dive lanes + dual-model cross-check honor them.
    ...(command.model_overrides === undefined ? {} : { model_overrides: command.model_overrides }),
    // Forward the env source so file-configured tiers take effect in the deep-dive phase too.
    ...(command.model_role_env === undefined ? {} : { model_role_env: command.model_role_env }),
    // Forward the circle-gate hardening knobs (k-sample agreement + evidence floors).
    ...(command.circle_gate === undefined ? {} : { circle_gate: command.circle_gate }),
  }, { ...deps, accumulated })

  return {
    research_case: researchCase,
    quick_screen: quickScreen,
    ...deepDiveResult,
  }
}

// ---------------------------------------------------------------------------
// Deep-dive phase (extracted so it can be called independently)
// ---------------------------------------------------------------------------

// The model's judged maintenance capex is flagged (ADVISORY) when it sits MATERIALLY below the conservative
// Greenwald/D&A proxy — i.e. more than this fraction below it (more aggressive OE → higher value). The flag
// NEVER blocks the verdict; it directs the human to verify the basis.
const MAINTENANCE_CAPEX_DIVERGENCE_FRACTION = 0.20

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
const RECENT_FILINGS_LANES = new Set<string>(['risks', 'moat', 'management', 'business_quality'])

/** Lanes that receive the LATEST PROXY STATEMENT affordance (3.1): management (incentives/comp —
 * primary) + moat (dual-class/entrenchment/governance — owner-approved SOURCE_POLICY v2 widening).
 * The numeric lanes are deliberately excluded; risks can already cite anything but has no comp mandate. */
const PROXY_LANES = new Set<string>(['management', 'moat'])

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
  for (let sampleIndex = 0; sampleIndex < gateKSamples; sampleIndex++) {
    const circle = await judgeCircleCompetence(provider, command, {
      ...deps,
      ...(preVerifiedSourcesBlock === undefined ? {} : { preVerifiedSourcesBlock }),
      // Let the circle gate READ the harness-grounded EDGAR 10-K by Item (already in `accumulated`).
      readCorpus: accumulated,
    }, { sampleIndex, minDrivers: gateMinDrivers, minBreakers: gateMinBreakers })
    remember(circle.captured)
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
    const groundedDrivers = circle.analysis.cashflow_drivers.filter(
      (d) => (d.driver?.trim().length ?? 0) > 0 && isCitationGrounded(d.citation, circleVerified),
    )
    const groundedBreakers = circle.analysis.predictability_breakers.filter(
      (b) => (b.breaker?.trim().length ?? 0) > 0 && isCitationGrounded(b.citation, circleVerified),
    )
    // Bug B: the gate keys off the cashflow_predictability ENUM. A sample votes in-competence ONLY when
    // the model judged 'durably_predictable' AND both clauses meet the GROUNDED evidence floors
    // (≥ min_drivers grounded, non-empty cashflow drivers AND ≥ min_breakers grounded, non-empty
    // predictability breakers). 'not_predictable' / 'uncertain' / a thin gather → fail-closed dissent.
    const predictability = circle.analysis.cashflow_predictability
    const driversGrounded = groundedDrivers.length >= gateMinDrivers
    const breakersGrounded = groundedBreakers.length >= gateMinBreakers
    const inCompetence = predictability === 'durably_predictable' && driversGrounded && breakersGrounded
    const samplePrefix = gateKSamples > 1 ? `sample ${sampleIndex + 1}/${gateKSamples} dissented — ` : ''
    const unmetReason = inCompetence
      ? undefined
      : predictability !== 'durably_predictable'
        ? `circle_competence_unmet: ${samplePrefix}the model judged this business's cashflows ${predictability === 'not_predictable' ? 'NOT durably predictable' : 'of UNCERTAIN predictability'} `
          + '— understanding the business is not the same as competence to value it; cyclical/commodity/unpredictable '
          + 'cashflows are outside the circle. A valid, common, correct Buffett output. Set aside.'
        : !driversGrounded
          ? `circle_competence_unmet: ${samplePrefix}the model judged the cashflows durably predictable but only `
            + `${groundedDrivers.length} grounded cashflow driver(s) met the evidence floor of ${gateMinDrivers} — a thin or `
            + 'ungrounded gather is outside competence (fail-closed). Set aside.'
          : `circle_competence_unmet: ${samplePrefix}the model grounded the cashflow drivers but only `
            + `${groundedBreakers.length} grounded predictability breaker(s) met the evidence floor of ${gateMinBreakers} — `
            + 'the deeper clause is held to the same rigor (fail-closed). Set aside.'
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
  const circleJudgmentPayload = {
    in_competence: inCompetence,
    cashflow_predictability: predictability,
    model_claimed_predictability: predictability,
    competence_reasoning: circle.analysis.competence_reasoning,
    cashflow_drivers: circle.analysis.cashflow_drivers.map((d) => ({
      driver: d.driver ?? '',
      citation: d.citation,
      grounded: (d.driver?.trim().length ?? 0) > 0 && isCitationGrounded(d.citation, circleVerified),
    })),
    predictability_breakers: circle.analysis.predictability_breakers.map((b) => ({
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
      model_claimed_predictability: s.predictability,
      grounded_drivers: s.groundedDrivers.length,
      grounded_breakers: s.groundedBreakers.length,
    })),
    ...(circleUnmetReason !== undefined ? { circle_competence_unmet: true, reason: circleUnmetReason } : {}),
  }

  // Emit the circle judgment event (causation = the quick-screen event; this is the first deep-dive stage).
  const circleJudged = await store.append({
    event_id: `evt_circle_competence_judged_${command.research_case_id}`,
    event_type: 'circle_competence_judged',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    causation_id: command.quick_screen_event_id,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload: { research_case_id: command.research_case_id, company_id: command.company_id, ticker: command.ticker, ...circleJudgmentPayload },
    source_ids: [...new Set([...groundedDrivers.map((d) => d.citation), ...groundedBreakers.map((b) => b.citation), ...circle.verified_ids])],
    created_at: new Date().toISOString(),
    schema_version: 1,
    idempotency_key: `circle-competence:${command.research_case_id}:v1`,
  } satisfies LedgerEventEnvelope<unknown>)

  if (!inCompetence) {
    // ---- OUTSIDE COMPETENCE → SET ASIDE (terminal PASS) — the 5 lanes do NOT run ----
    const circleSourceIds = [...new Set([...command.quick_screen_source_ids, ...circle.verified_ids])]
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
        circle_competence: circleJudgmentPayload,
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

  const queued = await queueDeepDive(store, {
    research_case_id: command.research_case_id,
    queue_id: `queue_${swarmSeg(command.research_case_id)}`,
    ...strategyRef,
    source_ids: command.quick_screen_source_ids,
    causation_id: command.quick_screen_event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-queue:${command.research_case_id}:v1`,
  })

  const started = await startDeepDive(store, {
    research_case_id: command.research_case_id,
    deep_dive_id: `deep_${swarmSeg(command.research_case_id)}`,
    ...strategyRef,
    specialist_lanes: lanes,
    source_ids: command.quick_screen_source_ids,
    causation_id: queued.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-start:${command.research_case_id}:v1`,
  })


  // ---- Per-lane swarm ----
  const laneResults = await runLaneSwarm(lanes, async (lane) => {
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
    const basePrompt = `You are the Buffett-Munger ${lane} specialist agent for ${command.ticker}. `
      + `Produce a source-backed finding for the ${lane} lane only. Gather your own sources; return them in proposed_sources with real URLs. `
      + `SOURCE DISCIPLINE (Mechanism 6): this lane reasons from PRIMARY documents. ${sourceDiscipline}`
      + (injectFilingNumbers ? primaryFilingBlock : '')
      + (recentFilingsBlock !== undefined && RECENT_FILINGS_LANES.has(lane) ? recentFilingsBlock : '')
      + (proxyBlock !== undefined && PROXY_LANES.has(lane) ? proxyBlock : '')

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
        { name: 'runway_drivers', present: (a) => Array.isArray(a.runway_drivers) && a.runway_drivers.length > 0, hint: 'the reinvestment-runway headroom drivers, each {headroom, citation} cited to a verified primary source' },
        { name: 'proposed_runway', present: (a) => a.proposed_runway !== undefined, hint: "'proven' | 'limited' | 'none' — your grounded runway judgment" },
      ]
      const validated = await runValidatedAgent(laneRuntime.provider, {
        run_id: baseRunId,
        model_id: laneRuntime.model_id,
        // citation/corpus-alignment (KO regression): the moat lane does NOT get the full primary-filing
        // numbers block (that stays on the financial lanes), but it DOES get the pre-verified EDGAR
        // source_id so the qualitative moat rows (M3-M6) cite the harness-verified filing id rather than
        // the model's own flaky SEC-archive id — the exact bug that scored KO's wide-moat rows to 0.
        prompt: basePrompt + MOAT_RUBRIC_PROMPT + (preVerifiedSourcesBlock ?? ''),
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
      // The grounded runway thesis is present only when BOTH the drivers (non-empty) and the proposed
      // runway survived (the fallback path leaves runway_thesis undefined → the resolver fails closed to a
      // conservative runway + judgment_degraded; never a silent admit).
      const runwayThesisPresent =
        Array.isArray(a.runway_drivers) && a.runway_drivers.length > 0 && a.proposed_runway !== undefined
      const moat_judgment: MoatLaneJudgment = {
        ...(moatThesisPresent
          ? {
              moat_thesis: {
                moat_drivers: a.moat_drivers,
                proposed_moat_class: a.proposed_moat_class,
                moat_reasoning: a.moat_reasoning ?? '',
              },
            }
          : {}),
        runway: a.runway,
        ...(a.runway_exceptional !== undefined ? { runway_exceptional: a.runway_exceptional } : {}),
        ...(runwayThesisPresent
          ? {
              runway_thesis: {
                runway_drivers: a.runway_drivers,
                proposed_runway: a.proposed_runway,
                runway_reasoning: a.runway_reasoning ?? '',
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
        moat_judgment,
        ...(agent.policy_rejections.length > 0 ? { policy_rejections: agent.policy_rejections } : {}),
        ...(validated.status === 'failed'
          ? { judgment_retry_degraded: `moat_lane_schema_retry_exhausted: the model omitted [${validated.missing.join(', ')}] after ${validated.attempts} attempts (${validated.reason}). Resolved holistically.` }
          : {}),
      }
    }

    // ---- Generic lanes (financial_quality, management, risks, …) ----
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
      verified_ids: withFiling(agent.verified_ids),
      ...(agent.policy_rejections.length > 0 ? { policy_rejections: agent.policy_rejections } : {}),
    }
  }, { concurrency: deps.laneConcurrency ?? 4 })

  // Extract the per-lane judgment outputs the harness now reads (instead of the synthesis schema).
  const moatLaneResult = laneResults.find((l) => l.lane === 'moat')
  const moatJudgment = moatLaneResult?.moat_judgment
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
  // The MOAT lane supplied the moat/runway rubric (spec-correct decomposition). The harness RE-VERIFIES
  // the computable rows from EDGAR, computes the mechanical anchor, and resolves the final tier under the
  // ±1 bound + citation rules (uncited/over-range rejected, not averaged; upward needs 2× evidence). The
  // RESOLVED tier supersedes the holistic moat_class/runway for the valuation. When no rubric is supplied
  // OR the resolved tier is not a valid downstream class, we fall back to the moat lane's holistic
  // moat_class/runway (or a conservative default) — visibly flagged. Grounding/citation verification is
  // unchanged. Resolved BEFORE the red team so its caseDigest sees the resolved tiers.
  const verifiedCitationHashes = new Set<string>()
  for (const s of accumulated.values()) {
    // Only VERIFIED sources (content_hash present) enter the cite-check set — a captured-but-unverified
    // source_id (fetch failed: SSRF/404/redirect-exhausted/network) must not satisfy a citation.
    if (s.content_hash === undefined) continue
    verifiedCitationHashes.add(s.content_hash)
    verifiedCitationHashes.add(s.source_id) // a lane may cite by source_id; both are corpus-verified
  }
  const judgment = resolveJudgmentTiers({
    // MOAT (B6 reframe): the grounded cited thesis (moat_drivers + proposed_moat_class). When the lane
    // omitted it, the moat axis fails closed to narrow + judgment_degraded (the silent-skip guard).
    ...(moatJudgment?.moat_thesis !== undefined ? { moatThesis: moatJudgment.moat_thesis } : {}),
    // RUNWAY (runway reframe): the grounded cited thesis (runway_drivers + proposed_runway). When the lane
    // omitted it, the runway axis fails closed to a conservative runway + judgment_degraded.
    ...(moatJudgment?.runway_thesis !== undefined ? { runwayThesis: moatJudgment.runway_thesis } : {}),
    // Holistic runway fallback so the resolved runway is NEVER undefined when the grounded thesis is omitted.
    ...(moatJudgment?.runway !== undefined ? { holisticRunway: moatJudgment.runway } : {}),
    ...(fundamentals?.annual_series !== undefined ? { series: fundamentals.annual_series } : {}),
    verifiedCitationHashes,
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
  const corpusBeforeSynthesis = [...accumulated.values()]
  const corpusHashesBeforeSynthesis = new Set<string>()
  for (const s of corpusBeforeSynthesis) {
    // Only VERIFIED sources (content_hash present) enter the cite-check set — a captured-but-unverified
    // source_id (fetch failed: SSRF/404/redirect-exhausted/network) must not satisfy a citation.
    if (s.content_hash === undefined) continue
    corpusHashesBeforeSynthesis.add(s.content_hash)
    corpusHashesBeforeSynthesis.add(s.source_id)
  }
  const laneDigest: RedTeamLaneDigest[] = laneResults
    .filter((l) => l.verified_ids.length > 0)
    .map((l) => ({ lane: l.lane, finding_summary: l.finding_summary, confidence: l.confidence }))
  const redTeam: RedTeamResult = await runRedTeamPass(
    redTeamRuntime.provider,
    {
      research_case_id: command.research_case_id,
      ticker: command.ticker,
      // model-tiering: the red_team registry role — a DIFFERENT model than the lanes when overridden.
      model_id: redTeamRuntime.model_id,
      laneDigest,
      // The moat/runway tiers are now resolved from the MOAT lane's rubric BEFORE the red team runs,
      // so the red team gets the concrete resolved tiers as its target (not a pending placeholder).
      caseDigest: {
        moat_class: judgment.moat!.resolved_moat_class,
        runway: judgment.runway!.resolved_runway,
      },
      corpusSourceIds: corpusBeforeSynthesis.map((s) => s.source_id),
      verifiedCitationHashes: corpusHashesBeforeSynthesis,
    },
    { ...(deps.ground === undefined ? {} : { ground: deps.ground }), ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }) },
  )

  // Compact red-team digest injected into the synthesis prompt so the synthesis verdict/rationale can
  // RECONCILE with the adversarial findings. The OBLIGATION to answer the strongest objection now lives in
  // a dedicated FOCUSED call (runRedTeamResponsePass below) — not on this monolithic schema — so this block
  // is reconciliation context only (no required synthesis_response here).
  const redTeamPromptBlock = redTeam.status === 'complete'
    ? `\n\nRED-TEAM PASS (Mechanism 5 — reconcile with this): an adversarial agent attacked this case. `
      + `Its STRONGEST OBJECTION (severity ${redTeam.strongest_objection.severity}): "${redTeam.strongest_objection.claim}" `
      + `[cited: ${redTeam.strongest_objection.citations.join(', ') || 'no verified citation'}]. `
      + `Bear case: ${redTeam.strongest_bear_case} Moat-decay: ${redTeam.moat_decay_scenario} Growth-credit attack: ${redTeam.growth_credit_attack}. `
      + `Reconcile your verdict + rationale with this objection (a dedicated follow-up call answers it formally). `
      + `You may echo the objection text into red_team_strongest_objection.`
    : `\n\nRED-TEAM PASS: the adversarial red-team pass did not complete (${redTeam.reason}); the case was NOT adversarially tested. `
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
  const shariahPassOutcome = await runShariahReasoningPass(
    shariahPassRuntime.provider,
    {
      research_case_id: command.research_case_id,
      ticker: command.ticker,
      model_id: shariahPassRuntime.model_id,
      laneDigest,
      corpusSourceIds: [...accumulated.values()].map((s) => s.source_id),
      preVerifiedSourceIds: primaryFilingSourceId !== undefined ? [primaryFilingSourceId] : [],
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

  // A live red-team objection (survived cite-check) makes a red-team RESPONSE required — produced by the
  // dedicated runRedTeamResponsePass below (the focused decomposition), NOT by the synthesis schema.
  const redTeamObjectionLive = redTeam.status === 'complete' && redTeam.strongest_objection.citations.length > 0
  // Spec-correct decomposition: the moat/runway rubric + the Shariah overlay are produced + retried on their
  // OWN specialist lanes, and the red-team response on its OWN focused call (below). Synthesis therefore has
  // NO judgment-overlay required fields — it just produces the verdict/thesis/valuation/Shariah rationale.
  // Founding-risk fix: the decision agent's valuation/growth claims must be GROUNDED in a verified source of
  // its OWN — so the citation fields are REQUIRED (runValidatedAgent retries when the model omits them). The
  // post-synthesis cite-check below then verifies they resolve against the corpus; absent/unverifiable →
  // synthesis_grounding_unmet → RESEARCH_MORE (the model's confident verdict is NOT recorded).
  const synthesisRequiredFields: RequiredFieldCheck<z.infer<typeof DecisionAgentSchema>>[] = [
    {
      name: 'valuation_reasoning.owner_earnings_citation',
      present: (a) => (a.valuation_reasoning?.owner_earnings_citation ?? '').length > 0,
      hint: 'the source_id of a VERIFIED primary source backing the owner-earnings figure (a real grounded source_id, not prose)',
    },
    {
      name: 'valuation_reasoning.assumed_growth_citation',
      present: (a) => (a.valuation_reasoning?.assumed_growth_citation ?? '').length > 0,
      hint: 'the source_id of a VERIFIED primary source backing the assumed-growth rationale (a real grounded source_id, not prose)',
    },
    // MARGIN-OF-SAFETY AUDIT SURFACE — required + substantive (the schema's .min(1) + the prompt's
    // specificity instruction + this retry are the guard against empty/boilerplate). Forward-looking model
    // risk judgments, so deliberately NOT cite-gated — an absent one does NOT route to RESEARCH_MORE.
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
    // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — REQUIRED + substantive. A substantive `present`
    // predicate: ≥1 named source AND a non-empty joint reasoning AND the reasoning for EACH named source is
    // present (price_gap_reasoning when 'price'; moat_durability_reasoning when 'moat'). Like the other MoS
    // surface this is forward-looking reasoning, deliberately NOT cite-gated; the retry forces the structure.
    {
      name: 'margin_of_safety',
      present: (a) => {
        const mos = a.margin_of_safety
        if (mos === undefined) return false
        const sources = Array.isArray(mos.sources) ? mos.sources : []
        if (sources.length === 0) return false
        if ((mos.reasoning ?? '').trim().length === 0) return false
        if (sources.includes('price') && (mos.price_gap_reasoning ?? '').trim().length === 0) return false
        if (sources.includes('moat') && (mos.moat_durability_reasoning ?? '').trim().length === 0) return false
        return true
      },
      hint: 'the synthesis-owned JOINT margin-of-safety judgment: which substitutable source(s) the margin rests on (price gap, moat durability, or both), the reasoning for EACH named source (price_gap_reasoning when "price"; moat_durability_reasoning when "moat"), and a reasoned adequacy + joint reasoning',
    },
  ]
  let dec: GroundedAgentResult<z.infer<typeof DecisionAgentSchema>>
  // Surfaced when the validate→retry wrapper exhausted its attempts and we fell back to the degraded
  // (still-parsed) payload — recorded as a visible degraded flag below so the gap is never silent.
  // (Synthesis has no required overlay fields now; this remains for any future required-field addition.)
  let synthesisValidationDegraded: string | undefined
  try {
    const validated = await runValidatedAgent(synthesisRuntime.provider, {
    run_id: `run_${command.research_case_id}_synthesis`,
    model_id: synthesisRuntime.model_id,
    prompt: `You are the Buffett-Munger synthesis+decision agent for ${command.ticker}. `
      + `Using the lane findings, produce a verdict, thesis, evidence, valuation rationale, Shariah rationale, risks, open questions, and a synthesis summary. `
      + `For the owner_earnings_bridge, provide company TOTALS in $millions from the latest 10-K (net_income, depreciation_amortization, maintenance_capex, stock_based_comp, normalized_working_capital_change) AND shares_outstanding (diluted weighted-average shares outstanding, in MILLIONS) so the harness can compute owner earnings per share. `
      + `Report incremental_roic (normalized INCREMENTAL ROIC as a fraction, e.g. 0.20) alongside reinvestment_rate (reported context). `
      + `YOU OWN THE VALUATION JUDGMENT. REQUIRED — do not omit: proposed_buy_below — the per-share price BELOW which you would buy, your own number, with your cited reasoning (the harness records it verbatim; it does NOT derive it from any fair value). ALSO produce valuation_reasoning: owner_earnings_basis (CITED — the owner-earnings figure you valued), owner_earnings_citation (REQUIRED — the source_id of a VERIFIED primary source from YOUR proposed_sources / the corpus that backs the owner-earnings figure; a real grounded source_id, NOT a prose hand-wave), assumed_growth (the near-term growth you assumed, a fraction), assumed_growth_rationale (CITED — WHY that growth is defensible; a durable source, not "strong execution"), assumed_growth_citation (REQUIRED — the source_id of a VERIFIED primary source backing that growth rationale; again a real grounded source_id, NOT prose), and optionally discount_rationale. The harness deterministically cite-checks owner_earnings_citation and assumed_growth_citation against the grounded corpus and FAILS CLOSED (routes to RESEARCH_MORE) when either is absent or does not verify — cite real grounded sources of your own. Estimate HONESTLY — do NOT lowball and do NOT over-reach: a growth above ~15% or a price implying it will be FLAGGED as implausible. Set valuation_status (ATTRACTIVE | FAIR | EXPENSIVE | INSUFFICIENT_DATA) consistently with that evidence — the harness sanity-checks it against the market-implied growth in BOTH directions. `
      + `MARGIN-OF-SAFETY AUDIT SURFACE — REQUIRED, do not omit: key_wrong_assumption and thesis_break_triggers, SPECIFIC to THIS business's thesis. key_wrong_assumption = the SINGLE assumption that, if WRONG, breaks this thesis — name a CONCRETE assumption you actually made (the assumed growth rate, the moat-durability claim, the maintenance-capex judgment), NOT a generic placeholder. thesis_break_triggers = the concrete, OBSERVABLE events that would invalidate the thesis, tied to THIS business (e.g. "gross margin falls below X%", "the top-2 customer concentration rises above Y%", "a funded entrant takes >Z% share") — NOT generic boilerplate like "if growth slows". Vague or generic answers are NOT acceptable. These are your forward-looking RISK reasoning for the human to audit; the harness does NOT cite-check them, but they MUST be substantive and business-specific. `
      + `MARGIN-OF-SAFETY JOINT JUDGMENT — REQUIRED, do not omit: margin_of_safety. YOU OWN this as a single joint judgment. The margin of safety comes from TWO SUBSTITUTABLE sources: (1) the PRICE-vs-value gap (your proposed_buy_below sits below value), and (2) MOAT DURABILITY (a fortress moat lets TIME bail out estimate error, so it needs LESS price discount). Name in 'sources' which source(s) THIS margin actually rests on — 'price', 'moat', or BOTH (they substitute: a wide-enough moat can carry a thinner price discount, and a deep-enough price discount can carry a narrower moat). For EACH named source give its reasoning: price_gap_reasoning when 'price' (WHY the price gap supplies margin for THIS business), moat_durability_reasoning when 'moat' (WHY the moat's durability supplies margin — and it MUST rest on the GROUNDED moat thesis the moat gate verified above, '${judgment.moat!.resolved_moat_class}', NOT a fresh moat claim). Then give a REASONED adequacy ('adequate' | 'thin' | 'inadequate') and a joint reasoning tying the named source(s) together. Be business-specific, NOT boilerplate. NOTE: adequacy is a REASONED JUDGMENT DISPLAYED for the human to audit — it does NOT change your verdict or buy-below (those stand on their own); it only ARTICULATES why the margin is or is not adequate. `
      // The moat/runway classification + rubrics and the Shariah overlay are produced by the MOAT and
      // SHARIAH specialist lanes — NOT here. The harness has already resolved them; the resolved tiers are
      // handed to you below for RECONCILIATION only (you do not re-score them).
      + `The MOAT lane resolved moat_class='${judgment.moat!.resolved_moat_class}' and reinvestment runway='${judgment.runway!.resolved_runway}'`
      + (shariahLaneJudgment !== undefined ? `; the Shariah screen assessed sector_status='${shariahLaneJudgment.sector_status}'` : '')
      + `. Reconcile your verdict + rationale with these resolved classifications; do NOT re-score the rubrics. `
      + `Cite sources in proposed_sources with real URLs.`
      // citation/corpus-alignment (KO regression): surface the harness's already-verified EDGAR source_id
      // so owner_earnings_citation / assumed_growth_citation cite the id the harness reliably verifies
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
  // The valuation_reasoning the harness reasons from downstream. It STARTS as the decision agent's own
  // (the happy path) and is REPLACED below by the focused valuation-reasoning call ONLY when the decision
  // dropped/ungrounded it (the focused-decomposition fallback — same pattern as the red-team response).
  let valuationReasoning: ValuationReasoning | undefined = dec.analysis.valuation_reasoning
  // Cite-check the (possibly-replaced) valuation_reasoning citations against the content_hash-verified corpus.
  const groundValuation = (vr: ValuationReasoning | undefined): { ownerGrounded: boolean; growthGrounded: boolean; ownerCite?: string; growthCite?: string } => {
    const ownerCite = vr?.owner_earnings_citation
    const growthCite = vr?.assumed_growth_citation
    return {
      ownerGrounded: ownerCite !== undefined && isCitationGrounded(ownerCite, synthesisCorpusHashes),
      growthGrounded: growthCite !== undefined && isCitationGrounded(growthCite, synthesisCorpusHashes),
      ...(ownerCite === undefined ? {} : { ownerCite }),
      ...(growthCite === undefined ? {} : { growthCite }),
    }
  }
  let g = groundValuation(valuationReasoning)
  // The VALUATION part of the grounding gate (owner-earnings + assumed-growth citations). The dec.verified_ids
  // layer (the agent grounded at least one source of its OWN) is independent of the valuation_reasoning and is
  // NOT something the focused call can repair — it stays evaluated on the decision agent itself.
  let valuationGroundingUnmet =
    valuationReasoning === undefined || !g.ownerGrounded || !g.growthGrounded

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
    const vrRuntime = resolveRoleRuntime('synthesis', provider, command)
    const vrOutcome = await runValuationReasoningPass(
      vrRuntime.provider,
      {
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        model_id: vrRuntime.model_id,
        laneDigest,
        corpusSourceIds: [...accumulated.values()].map((s) => s.source_id),
        preVerifiedSourceIds: primaryFilingSourceId !== undefined ? [primaryFilingSourceId] : [],
      },
      { ...(deps.ground === undefined ? {} : { ground: deps.ground }), ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }) },
    )
    if (vrOutcome.status === 'ok') {
      // Persist the focused call's captured sources into the corpus (like the red-team response) so the
      // cite-check below sees them, then RE-EVALUATE grounding against the focused result.
      remember(vrOutcome.captured)
      for (const s of accumulated.values()) {
        if (s.content_hash === undefined) continue
        synthesisCorpusHashes.add(s.content_hash)
        synthesisCorpusHashes.add(s.source_id)
      }
      const candidate = vrOutcome.valuation_reasoning
      const cg = groundValuation(candidate)
      if (cg.ownerGrounded && cg.growthGrounded) {
        // The focused call grounded it → adopt it as the valuation_reasoning + clear the valuation gate.
        valuationReasoning = candidate
        g = cg
        valuationGroundingUnmet = false
      } else {
        // The focused call produced a payload but its citations do NOT verify → fail-closed (preserved).
        valuationReasoningDegraded =
          'valuation_reasoning_retry_exhausted: the focused valuation-reasoning call produced owner-earnings/'
          + 'assumed-growth citations that did not verify against the corpus — the valuation stays ungrounded. '
          + 'Routed to RESEARCH_MORE; re-run on a more capable model.'
      }
    } else {
      // The focused call also failed (omitted the required field / errored / timed out) after its attempts.
      valuationReasoningDegraded =
        `valuation_reasoning_retry_exhausted: the focused valuation-reasoning call did not produce a usable, `
        + `grounded valuation_reasoning after ${vrOutcome.attempts} attempt(s) (${vrOutcome.reason}). `
        + `The valuation stays ungrounded — routed to RESEARCH_MORE; re-run on a more capable model.`
    }
  }

  const ownerEarningsCitation = g.ownerCite
  const assumedGrowthCitation = g.growthCite
  const ownerEarningsGrounded = g.ownerGrounded
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
        ? 'synthesis_grounding_unmet: the decision agent produced no valuation_reasoning (owner-earnings + assumed-growth '
          + 'basis/citations) and the focused valuation-reasoning call could not ground one — its valuation is ungrounded. '
          + 'Routed to RESEARCH_MORE; re-run.'
        : !ownerEarningsGrounded
          ? `synthesis_grounding_unmet: owner_earnings_citation '${ownerEarningsCitation ?? '(absent)'}' did not verify `
            + 'against the corpus — the owner-earnings basis is ungrounded. Routed to RESEARCH_MORE; re-run.'
          : `synthesis_grounding_unmet: assumed_growth_citation '${assumedGrowthCitation ?? '(absent)'}' did not verify `
            + 'against the corpus — the assumed-growth rationale is ungrounded. Routed to RESEARCH_MORE; re-run.'

  // ---- Mechanism 5: dedicated red-team-RESPONSE call (the focused decomposition) ----
  // The synthesis_response that answers the red team's strongest objection is produced by a SMALL focused
  // grounded call (NOT the monolithic synthesis schema, which a live model kept dropping it from). It runs
  // ONLY when a live (cite-checked) objection exists; it cites the verified corpus and is forced by
  // runValidatedAgent's retry. On exhaustion/failure the response stays undefined → the existing
  // deterministic red_team_objection_unaddressed enforcement fires (visible fallback; the run completes).
  let redTeamSynthesisResponse: SynthesisResponse | undefined
  let redTeamResponseDegraded: string | undefined
  if (redTeamObjectionLive && redTeam.status === 'complete') {
    // Reuse the red_team registry role for the follow-up so it can run on the same (or a pinned) model.
    const responseRuntime = resolveRoleRuntime('red_team', provider, command)
    const responseOutcome = await runRedTeamResponsePass(
      responseRuntime.provider,
      {
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        model_id: responseRuntime.model_id,
        strongestObjection: redTeam.strongest_objection,
        laneDigest,
        corpusSourceIds: [...accumulated.values()].map((s) => s.source_id),
      },
      { ...(deps.ground === undefined ? {} : { ground: deps.ground }), ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }) },
    )
    if (responseOutcome.status === 'ok') {
      redTeamSynthesisResponse = responseOutcome.synthesis_response
      remember(responseOutcome.captured)
    } else {
      // Visible degradation: the dedicated call also failed after its attempts. The run still completes;
      // buildRedTeamLayer flags red_team_objection_unaddressed (the response stays undefined below).
      redTeamResponseDegraded =
        `red_team_response_retry_exhausted: the dedicated red-team-response call did not produce a usable `
        + `synthesis_response after ${responseOutcome.attempts} attempt(s) (${responseOutcome.reason}). `
        + `The red-team objection is recorded as unaddressed — re-run on a more capable model.`
    }
  }

  // ---- Mechanism 5: red-team obligation enforcement (deterministic — "silence is not an option") ----
  // The red team handed synthesis its strongest objection; the dedicated red-team-response call MUST have
  // answered it with cited evidence or accepted it and downgraded. The harness builds the red-team layer
  // and — when the red team completed with a LIVE (cite-checked) objection and the focused call supplied
  // NO usable response — flags red_team_objection_unaddressed + appends it to open_questions
  // (conservative: never silently dropped). A red-team-incomplete state is also surfaced as an open
  // question. The downgrade (mode 'accepted_downgraded') is recorded in the layer for the verdict.
  const { layer: redTeamLayer, openQuestion: redTeamOpenQuestion } = buildRedTeamLayer({
    redTeam,
    synthesisResponse: redTeamSynthesisResponse,
  })

  const allVerified = [
    ...new Set([
      ...command.quick_screen_source_ids,
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
  // The dedicated red-team-response call exhausted its retries (the focused decomposition's own visible
  // fallback) — surfaced so the gap is seen; the red_team_objection_unaddressed open question is also set.
  if (redTeamResponseDegraded !== undefined) {
    degradedFlags.push(redTeamResponseDegraded)
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
  if (judgment.moat?.judgment_degraded === 'rubric_not_emitted' || judgment.runway?.judgment_degraded === 'rubric_not_emitted') {
    degradedFlags.push(
      'judgment_degraded: rubric_not_emitted — the model omitted the grounded moat/runway thesis; the moat '
      + 'class and reinvestment runway were resolved from the holistic lane judgment (or a conservative default), '
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
            + `Be disciplined and conservative — do NOT inflate the moat from narrative.`,
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

  const modelBridge = dec.analysis.owner_earnings_bridge

  // ---- EDGAR-anchored owner-earnings bridge ("judgment proposes, code computes") ----
  // When EDGAR fundamentals are present, the harness anchors NI/D&A/capex/SBC/diluted-shares to the
  // PRIMARY 10-K and recomputes maintenance capex from the LLM's proxy tier (its only capex judgment):
  //   maintenance_capex = min(D&A, capex × maintenance_fraction)   (buffett-valuation-method-v2 Step 2)
  // The LLM still supplies the JUDGMENT overlay: the maintenance fraction (via tier), the normalized
  // working-capital change, and any one-off normalization to net income. When EDGAR is absent
  // (non-US ticker / feed down / test fallback) we keep TODAY's behavior (model-proposed bridge).
  const edgarAnnual = fundamentals?.latest_annual
  const edgarBridgeUsable =
    edgarAnnual !== undefined
    && Number.isFinite(edgarAnnual.net_income_musd ?? NaN)
    && Number.isFinite(edgarAnnual.d_and_a_musd ?? NaN)
    && Number.isFinite(edgarAnnual.capex_musd ?? NaN)
    && Number.isFinite(edgarAnnual.sbc_musd ?? NaN)
    && Number.isFinite(edgarAnnual.diluted_shares_m ?? NaN)
    && (edgarAnnual.diluted_shares_m ?? 0) > 0

  // The model proposes a normalization DELTA to net income (proposed normalized NI − reported NI);
  // applied to EDGAR's reported NI so the LLM keeps the normalization judgment without restating the
  // primary figure. The dNWC overlay is taken straight from the model bridge (signed).
  const bridge_basis: 'sec_edgar' | 'model_proposed' = edgarBridgeUsable ? 'sec_edgar' : 'model_proposed'

  let net_income: number
  let d_and_a: number
  let maintenance_capex: number
  let stock_based_comp: number
  let shares_outstanding: number
  let bridge_fiscal_year: number | undefined
  let bridge_source_id: string | undefined
  // The deterministic Greenwald/D&A maintenance-capex proxy is now a SANITY-CHECK REFERENCE (NOT the binding
  // OE input). Surfaced on the valuation payload + used for the advisory divergence flag; undefined when the
  // EDGAR series is too thin to compute either proxy.
  let maintenance_capex_proxy_reference: number | undefined

  if (edgarBridgeUsable && edgarAnnual !== undefined) {
    const maintenance_fraction = maintenanceFractionForTier(modelBridge.maintenance_capex_proxy_tier)
    const edgar_d_and_a = edgarAnnual.d_and_a_musd as number
    const edgar_capex = edgarAnnual.capex_musd as number
    // Net income is ANCHORED to EDGAR's reported figure. The model may propose a one-off NORMALIZATION
    // (buffett-valuation-method-v2 Step 2), but only as a BOUNDED delta (±OE_NORMALIZATION_MAX_FRACTION ×
    // |edgar NI|). A wild proposal — net_income 0 while EDGAR is substantially positive, non-finite, or a
    // delta beyond the band — is CLAMPED + flagged so the EDGAR anchor (not the model) owns the figure.
    // This fixes the prior no-op (edgar + (model − edgar) = model) that let net_income=0 void the valuation.
    const niAnchor = anchorNetIncomeToEdgar(modelBridge.net_income, edgarAnnual.net_income_musd!)
    net_income = niAnchor.value
    if (niAnchor.clamped && niAnchor.flag !== undefined) degradedFlags.push(niAnchor.flag)
    d_and_a = edgar_d_and_a
    // Maintenance-vs-growth capex is a JUDGMENT — what fraction of total capex is maintenance. Per the
    // architecture that judgment is the MODEL's (grounded in the EDGAR capex/D&A facts, cite-verified via
    // A1's owner_earnings_citation), NOT the deterministic Greenwald/D&A proxy. The OE arithmetic stays
    // deterministic; only its maint-capex INPUT is the model's number. NI/D&A/SBC remain EDGAR-anchored.
    //
    // The Greenwald/D&A proxy (Greenwald vs D&A floor, more conservative) is kept as a SANITY-CHECK
    // REFERENCE (surfaced + an advisory divergence flag), never the binding input. The legacy
    // min(D&A, capex × model tier) remains the SAFE fallback when the model's value is rejected by the
    // deterministic envelope (or when EDGAR is absent). The model tier still informs that fallback.
    maintenance_capex_proxy_reference = fundamentals?.annual_series !== undefined
      ? estimateMaintenanceCapex(fundamentals.annual_series).maintenance_capex
      : undefined
    const legacyMaint = Math.min(edgar_d_and_a, edgar_capex * maintenance_fraction)
    // Deterministic sanity ENVELOPE (arithmetic guard, NOT a judgment): the model's maintenance_capex must
    // be finite and within [0, total capex]. It cannot be negative; it cannot exceed total capex (that is
    // not maintenance — it is a units/logic error). Outside the envelope → reject the model's value with a
    // VISIBLE flag and fall back to the SAFE value (the proxy reference, else the legacy tier fallback).
    const safeMaint = maintenance_capex_proxy_reference ?? legacyMaint
    const modelMaint = modelBridge.maintenance_capex
    if (!Number.isFinite(edgar_capex)) {
      // Without a total-capex upper bound the envelope cannot be enforced — fall back to the safe value.
      maintenance_capex = safeMaint
      degradedFlags.push(
        `oe_bridge_maintenance_capex_envelope_unenforceable: total capex unavailable from EDGAR — cannot bound `
        + `the model's maintenance_capex=${modelMaint}. Falling back to the conservative proxy reference (${safeMaint}).`,
      )
    } else if (!Number.isFinite(modelMaint) || modelMaint < 0 || modelMaint > edgar_capex) {
      maintenance_capex = safeMaint
      degradedFlags.push(
        `range_check_rejected: maintenance_capex=${modelMaint} is outside the envelope [0, total capex ${edgar_capex}] `
        + `(negative or exceeds total capex is a units/logic error, not maintenance). Value discarded; fell back to the `
        + `conservative Greenwald/D&A proxy reference (${safeMaint}).`,
      )
    } else {
      // The model's judged maintenance_capex is the binding OE input.
      maintenance_capex = modelMaint
      // ADVISORY divergence flag (NEVER blocks the verdict; the human audits): the model's maint capex is
      // MATERIALLY below the conservative proxy → more aggressive OE → higher value. Flag for verification.
      if (
        maintenance_capex_proxy_reference !== undefined
        && maintenance_capex_proxy_reference > 0
        && modelMaint < maintenance_capex_proxy_reference * (1 - MAINTENANCE_CAPEX_DIVERGENCE_FRACTION)
      ) {
        degradedFlags.push(
          `maintenance_capex_below_proxy: the model assumes maintenance capex ($${modelMaint}M) materially below the `
          + `conservative Greenwald/D&A proxy ($${maintenance_capex_proxy_reference}M) — verify the basis; owner earnings `
          + `may be overstated. Advisory only (does not change the verdict).`,
        )
      }
    }
    stock_based_comp = edgarAnnual.sbc_musd as number  // SBC always subtracted, in full
    shares_outstanding = edgarAnnual.diluted_shares_m as number  // CURRENT diluted shares
    bridge_fiscal_year = edgarAnnual.fiscal_year
    bridge_source_id = primaryFilingSourceId
  } else {
    net_income = modelBridge.net_income
    d_and_a = modelBridge.depreciation_amortization
    // Harness defense 3: a model-proposed maintenance capex that exceeds revenue (or is negative/
    // non-finite) is implausible — reject it and fall back to D&A as a safe proxy (the OE bridge caps
    // maintenance capex at D&A anyway), recording a visible flag rather than feeding a garbage number.
    const revenueForCheck = fundamentals?.latest_annual?.revenue_musd
    const maintSanity = revenueForCheck !== undefined && Number.isFinite(revenueForCheck)
      ? sanitizeMaintenanceCapex(modelBridge.maintenance_capex, { revenue: revenueForCheck })
      : (Number.isFinite(modelBridge.maintenance_capex) && modelBridge.maintenance_capex >= 0
        ? { value: modelBridge.maintenance_capex, rejected: false as const }
        : { value: undefined, rejected: true as const, flag: `range_check_rejected: maintenance_capex=${modelBridge.maintenance_capex} is non-finite or negative. Value discarded.` })
    if (maintSanity.rejected && 'flag' in maintSanity && maintSanity.flag !== undefined) degradedFlags.push(maintSanity.flag)
    maintenance_capex = maintSanity.value ?? Math.max(0, Number.isFinite(d_and_a) ? d_and_a : 0)
    stock_based_comp = modelBridge.stock_based_comp
    shares_outstanding = modelBridge.shares_outstanding
  }

  // The model's signed working-capital overlay is range-sanity'd against revenue: a ΔNWC whose magnitude
  // exceeds |revenue| (or is non-finite) is implausible (units/scale error) and discarded (→ 0) with a
  // visible flag, rather than feeding a spurious OE swing. (The sign is preserved when accepted.)
  const revenueForNwc = fundamentals?.latest_annual?.revenue_musd
  const nwcSanity = revenueForNwc !== undefined && Number.isFinite(revenueForNwc)
    ? sanitizeWorkingCapitalChange(modelBridge.normalized_working_capital_change, { revenue: revenueForNwc })
    : (Number.isFinite(modelBridge.normalized_working_capital_change)
      ? { value: modelBridge.normalized_working_capital_change, rejected: false as const }
      : { value: undefined, rejected: true as const, flag: `range_check_rejected: normalized_working_capital_change=${modelBridge.normalized_working_capital_change} is non-finite. Value discarded (treated as 0).` })
  if (nwcSanity.rejected && 'flag' in nwcSanity && nwcSanity.flag !== undefined) degradedFlags.push(nwcSanity.flag)
  const normalized_working_capital_change = nwcSanity.value ?? 0

  // The recorded bridge reflects what the harness actually used (EDGAR-anchored when available),
  // preserving the model's tier + working-capital judgment. When the bridge is EDGAR-anchored we record
  // the PRIMARY filing's reporting currency (USD for us-gaap filers, the functional currency for IFRS
  // 20-F foreign private issuers, e.g. DKK for Novo Nordisk) so downstream currency-consistency checks
  // (and the qualification scorer) compare like-for-like instead of mixing a DKK bridge with a USD scale.
  const reporting_currency = edgarBridgeUsable ? fundamentals?.currency : undefined
  const bridge = {
    ...(reporting_currency === undefined ? {} : { reporting_currency }),
    net_income,
    depreciation_amortization: d_and_a,
    maintenance_capex,
    maintenance_capex_proxy_tier: modelBridge.maintenance_capex_proxy_tier,
    stock_based_comp,
    normalized_working_capital_change,
    shares_outstanding,
  }

  const ownerEarningsVsFcf = ownerEarningsVsFcfDiagnostic(fundamentals?.latest_annual, maintenance_capex)
  for (const flag of ownerEarningsVsFcf.flags) degradedFlags.push(`fcf_screen: ${flag}`)

  const owner_earnings_total =
    net_income
    + d_and_a
    - maintenance_capex
    - stock_based_comp
    - normalized_working_capital_change  // signed: subtract (positive = use of cash, negative = release)

  // Convert total owner earnings ($M) to per-share using diluted shares outstanding (M).
  // Guard: shares_outstanding must be a positive, finite number — otherwise we cannot compute a
  // meaningful per-share figure and must degrade gracefully (no bogus huge fair value).
  const shares_valid = Number.isFinite(shares_outstanding) && shares_outstanding > 0
  const normalized_owner_earnings_per_share = shares_valid
    ? owner_earnings_total / shares_outstanding
    : undefined

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
  const discount = discountRate(buffettMungerStrategy, risk_free_rate)
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
  // resolved_runway is guaranteed defined by resolveJudgmentTiers (never undefined).
  const runway = judgment.runway!.resolved_runway
  // runway_exceptional is now the MOAT lane's judgment (spec-correct decomposition), defaulting false.
  const runway_exceptional = moatJudgment?.runway_exceptional ?? false
  const valuation_multiple_ceiling = buffettMungerStrategy.valuation.valuation_multiple_ceiling

  const valuationCaveats: string[] = []
  let implied_multiple: number | undefined
  let terminal_growth_rate: number | undefined
  let terminal_value_pct_of_iv: number | undefined
  let cap_exceeded = false

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
    ? demonstratedOwnerEarningsGrowth(fundamentals.annual_series)
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
  const growthResult = creditedGrowth(buffettMungerStrategy, {
    demonstrated_growth,
    ...(laneArguedGrowth !== undefined ? { agent_proposed_growth: laneArguedGrowth } : {}),
  })
  const effective_growth_rate = growthResult.growth
  const growth_basis: 'edgar_oe_cagr' | 'none' =
    fundamentals?.annual_series !== undefined && demonstrated_growth > 0 ? 'edgar_oe_cagr' : 'none'
  // Above-GDP coupling flag → surfaced so growth is reviewed WITH the moat-durability input.
  if (moat_passes_gate && growthResult.above_gdp && growthResult.above_gdp_flag !== undefined) {
    degradedFlags.push(growthResult.above_gdp_flag)
  }
  if (moat_passes_gate && effective_growth_rate === 0) {
    degradedFlags.push(
      'valuation_degraded: demonstrated_growth_reference_floored_g0 — the demonstrated owner-earnings/share '
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

  // Plausibility ceiling for a per-share fair value. A per-share owner-earnings valuation for any
  // real equity is far below this; anything at/above it signals a units bug (e.g. totals not divided
  // by shares) and must be discarded rather than persisted.
  const MAX_PLAUSIBLE_FAIR_VALUE_PER_SHARE = 1_000_000

  if (!shares_valid) {
    valuationCaveats.push(
      'Valuation not computed: shares_outstanding missing or non-positive — cannot derive owner earnings per share. Re-run with grounded share count before relying on any buy price.',
    )
  } else if (normalized_owner_earnings_per_share !== undefined && normalized_owner_earnings_per_share <= 0) {
    // Negative/zero owner earnings gate (Step 6 gate 2): record a caveat, emit no fair value.
    valuationCaveats.push(
      `Valuation not computed: normalized owner earnings per share (${normalized_owner_earnings_per_share.toFixed(2)}) is not positive after SBC — fails the owner-earnings gate. No fair value or buy price emitted.`,
    )
  } else if (moat_passes_gate && normalized_owner_earnings_per_share !== undefined) {
    const terminal_g = terminalGrowthForMoat(buffettMungerStrategy, moatClass)
    // Stage-1 horizon — UNIFORM 10 yrs for every investable moat (F.13); the moatClass arg validates the gate.
    const horizon = stage1HorizonForMoat(buffettMungerStrategy, moatClass)
    // terminal_growth_rate is the per-moat Gordon stage; set it WHENEVER the gate passes with a usable OE/sh,
    // independent of whether a headline FV is produced — implied_exit_multiple and the reverse-DCF
    // market_implied_growth both consume it (they fail-closed on undefined otherwise).
    terminal_growth_rate = terminal_g
    // INTERNAL forward-DCF (NOT surfaced): computed from the MODEL's cited assumed_growth (headline_growth)
    // ONLY to derive the implied_multiple + the terminal-share / cap sanity flags. The dollar fair value
    // itself is no longer emitted or displayed (forward-DCF removal). Computed only when assumed_growth is
    // grounded + usable (A1); an ungrounded assumed_growth leaves it undefined.
    if (headline_growth !== undefined) {
    // Phase 1.5/1.6: rich two-stage valuation — surfaces terminal_value_pct_of_iv, flags cap_exceeded
    // (no silent truncation), and discards only an absurd (units-bug) value.
    const valuation = twoStageValuation({
      oe_ps: normalized_owner_earnings_per_share,
      g: headline_growth,
      terminal_g,
      discount,
      ceiling_multiple: valuation_multiple_ceiling,
      absurd_multiple: buffettMungerStrategy.valuation.fv_absurd_multiple,
      horizon,
    })
    terminal_value_pct_of_iv = valuation.terminal_value_pct_of_iv
    cap_exceeded = valuation.cap_exceeded
    const computedFairValue = valuation.fair_value
    // Sanity guard: degrade gracefully if the value was discarded (absurd) or implausibly large/non-positive.
    if (valuation.absurd || computedFairValue === undefined || !Number.isFinite(computedFairValue) || computedFairValue <= 0 || computedFairValue > MAX_PLAUSIBLE_FAIR_VALUE_PER_SHARE) {
      valuationCaveats.push(
        `Valuation discarded: computed fair value per share (${computedFairValue !== undefined && Number.isFinite(computedFairValue) ? computedFairValue.toFixed(2) : 'non-finite/absurd'}) is implausible — owner-earnings inputs likely mis-scaled. No buy price emitted.`,
      )
    } else {
      // forward-DCF removal: the dollar forward FV is no longer surfaced; it is used here ONLY to derive the
      // implied_multiple ratio + the terminal-share / cap sanity flags.
      implied_multiple = computedFairValue / normalized_owner_earnings_per_share
      // Phase 1.5: flag a high terminal-value share (the dominant uncertainty).
      const highTvShare = terminal_value_pct_of_iv > buffettMungerStrategy.valuation.terminal_value_share_flag
      if (highTvShare) {
        degradedFlags.push(
          `terminal_value_share_high: terminal value is ${(terminal_value_pct_of_iv * 100).toFixed(0)}% of intrinsic `
          + `value (> ${(buffettMungerStrategy.valuation.terminal_value_share_flag * 100).toFixed(0)}%) — most of the `
          + `estimate is a guess about the distant future (a moat-durability judgment). Widens the margin of safety.`,
        )
      }
      // Phase 1.6: the 18× OE cap is a SURFACED flag, not a truncation.
      if (cap_exceeded) {
        degradedFlags.push(
          `valuation_cap_exceeded: fair value ${computedFairValue.toFixed(2)} exceeds ${valuation_multiple_ceiling}× owner `
          + `earnings (${(valuation_multiple_ceiling * normalized_owner_earnings_per_share).toFixed(2)}) — a sanity flag, `
          + `not a truncation. Re-check the growth/terminal inputs before relying on the buy-below.`,
        )
      }
      // NOTE: the MoS-as-price-haircut knob (widenedMarginOfSafety → margin_of_safety) is RETIRED. The
      // valuation-core revision moved ALL conservatism into the required_growth_gap (see requiredGrowthGap
      // below); the SAME documented uncertainties (terminal-value share, maint-capex confidence, above-GDP
      // durability) now widen the GAP in growth-rate points instead of haircutting the price.
      //
      // NOTE: buy_price_per_share is NO LONGER fair_value × (1 − MoS). The valuation-core revision (V3)
      // moved the buy decision to implied-growth-vs-band, so the buy-below is now the PRICE at which the
      // market-implied growth rises to the buy-threshold (band_low − required_gap). It is derived below,
      // once the sustainable-growth band and required gap are computed (see the verdict-band section).

      // forward-DCF removal: the forward two-stage DCF "reference fair value" (the dollar fair_value_per_share
      // / reference_fair_value / fair_value_range band) is no longer surfaced — it read as a contradiction
      // against the model's buy-below. The reverse-DCF (market-implied growth) is the kept valuation lens. The
      // forward FV is still computed internally above ONLY to derive the implied_multiple + the terminal-share
      // / cap sanity flags; it is never emitted or displayed.
    }
    } // end if (headline_growth !== undefined) — internal forward-DCF for the implied multiple + sanity flags
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

  // ---- Phase 2: reverse-DCF market-implied growth (attachment/presentation only) ----
  // "What near-term owner-earnings growth does TODAY'S price imply?" — inverts the SAME faded two-stage
  // DCF the point valuation used (same oe_ps, discount, terminal, horizon basis), so reverse and forward
  // stay consistent. Fail-closed: omit entirely when no current price or no positive owner earnings/share
  // (never fabricate a price or a rate). Grounded in the live price already used + the EDGAR oe_ps.
  // Only computed when a POINT fair value was produced (moat investable, valid OE/share, FV not discarded)
  // — that guarantees the per-moat terminal_growth_rate the point valuation used is defined, so the reverse
  // solve inverts the SAME forward DCF. terminalGrowthForMoat throws for non-investable moats, so gating on
  // fair_value_per_share avoids that path entirely.
  // market_implied_growth is the PRIMARY lens: the reverse-DCF of TODAY's price against the EDGAR
  // owner-earnings basis — it does NOT consume the model's assumed_growth, so it must stay ungated when the
  // assumed_growth is ungrounded (A1 omits the headline FV in that case, but the price+OE-derived
  // market-implied growth remains grounded and must still compute). It depends ONLY on the inputs
  // marketImpliedGrowth() actually uses — price, owner-earnings/share, terminal growth, discount, horizon —
  // NOT on the headline fair_value_per_share.
  let market_implied_growth: number | undefined
  if (
    current_price !== undefined
    && terminal_growth_rate !== undefined
    && normalized_owner_earnings_per_share !== undefined
    && normalized_owner_earnings_per_share > 0
  ) {
    const impliedHorizon = stage1HorizonForMoat(buffettMungerStrategy, moatClass)
    const implied = marketImpliedGrowth({
      price: current_price,
      oe_ps: normalized_owner_earnings_per_share,
      terminal_g: terminal_growth_rate,
      discount,
      horizon: impliedHorizon,
    })
    if (implied.status === 'solved' && implied.implied_growth !== undefined) {
      market_implied_growth = implied.implied_growth
    }
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
    const ratios = computeShariahFinancialRatios({
      // Missing interest-bearing debt / cash → treated as 0 (a near-zero-debt firm legitimately has a
      // 0% debt ratio, not NaN → not-computable). Revenue + market cap are the only required inputs.
      interest_bearing_debt: la.total_debt_musd,
      cash_and_securities: la.cash_and_securities_musd,
      total_revenue: la.revenue_musd,
      market_cap,
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
        market_cap,
        market_cap_basis,
        ...(avgMarketCap !== undefined ? { market_cap_months: avgMarketCap.months } : {}),
        bridge_source_fiscal_year: la.fiscal_year,
        ...(impermissibleIncomeShownLines !== undefined ? { impermissible_income_lines: impermissibleIncomeShownLines } : {}),
      }
    } else {
      shariahRatioNotComputableReason = ratios.reason
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
  const dr = valuationReasoning
  const assumed_growth = dr?.assumed_growth
  const valuation_status = dec.analysis.valuation_status

  // forward-DCF removal: the forward two-stage DCF "reference fair value" (a dollar cross-check FV at the
  // model's assumed growth) is no longer computed or surfaced — a dollar reference FV below the model's
  // buy-below read as a contradiction. The reverse-DCF market-implied growth (computed above) is the kept
  // valuation lens; the buy-below is the model's own number.

  // buy_below = the MODEL's proposed number (NOT a derived FV). Recorded verbatim when finite + positive.
  const buy_below = (typeof dec.analysis.proposed_buy_below === 'number'
    && Number.isFinite(dec.analysis.proposed_buy_below)
    && dec.analysis.proposed_buy_below > 0)
    ? dec.analysis.proposed_buy_below
    : undefined

  // in_buy_zone — pure arithmetic comparison on the model's number (fine; it is arithmetic, not judgment).
  const in_buy_zone = current_price !== undefined && buy_below !== undefined
    ? current_price <= buy_below
    : undefined


  // ---- implied_exit_multiple: name-specific, flag-only §2 sanity output (NEVER blocks/clamps) ----
  // The exit P/OE multiple TODAY'S price implies you would have to EXIT at after the explicit horizon, given
  // the model's growth path. Reuses the existing valuation math — NO new engine:
  //   OE_H = ownerEarningsAtHorizon(oe_ps, g = model assumed_growth, terminal_g, horizon)   (the SAME faded
  //          stage-1 path the two-stage DCF + reference FV use)
  //   implied_exit_multiple = current_price / OE_H
  // i.e. the price expressed as a multiple of the owner earnings the company is projected to earn at the end
  // of the explicit window — the P/OE the price requires a future buyer to pay at exit. Name-specific: rises
  // with the live price and varies with the model's assumed growth + the owner-earnings basis — NOT a config
  // constant. Fail-closed: omitted unless price + positive OE/share + the model's assumed growth + terminal
  // all exist, and the result is finite + positive (never a spurious value, so no low-side flag).
  // A1 SYMMETRY: implied_exit_multiple grows the owner earnings along the MODEL's assumed_growth path, so it
  // CONSUMES the assumed_growth claim and is gated on the SAME cite-verified signal as the headline
  // (headline_growth !== undefined). An ungrounded-but-present assumed_growth omits it, exactly like the
  // headline. (market_implied_growth — the reverse-DCF of price + EDGAR OE — does NOT consume assumed_growth
  // and stays ungated.)
  let implied_exit_multiple: number | undefined
  if (
    headline_growth !== undefined
    && current_price !== undefined
    && current_price > 0
    && normalized_owner_earnings_per_share !== undefined
    && normalized_owner_earnings_per_share > 0
    && assumed_growth !== undefined
    && Number.isFinite(assumed_growth)
    && terminal_growth_rate !== undefined
  ) {
    const exitHorizon = stage1HorizonForMoat(buffettMungerStrategy, moatClass)
    const oeAtHorizon = ownerEarningsAtHorizon({
      oe_ps: normalized_owner_earnings_per_share,
      g: assumed_growth,
      terminal_g: terminal_growth_rate,
      horizon: exitHorizon,
    })
    if (oeAtHorizon > 0 && Number.isFinite(oeAtHorizon)) {
      const exitMultiple = current_price / oeAtHorizon
      if (Number.isFinite(exitMultiple) && exitMultiple > 0) {
        implied_exit_multiple = Math.round(exitMultiple * 10) / 10
      }
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
  const sanity_flags: string[] = []
  const singleGrowthCap = buffettMungerStrategy.valuation.single_growth_cap
  const gdpThreshold = buffettMungerStrategy.valuation.gdp_growth_threshold
  const fvCapMultiple = valuation_multiple_ceiling

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

  // (d/e) SYMMETRIC valuation_status vs evidence contradiction (both directions).
  if (market_implied_growth !== undefined) {
    if (valuation_status === 'ATTRACTIVE' && market_implied_growth > singleGrowthCap) {
      // Over-OPTIMISTIC catch: model calls it attractive, yet the market already prices implausible growth.
      sanity_flags.push(
        `sanity_status_contradicts_evidence: model says valuation is ATTRACTIVE, yet today's price already implies `
        + `~${(market_implied_growth * 100).toFixed(1)}% growth (above the ${(singleGrowthCap * 100).toFixed(0)}% cap) — the market `
        + `already prices implausible growth, so "attractive" is hard to credit. Re-check.`,
      )
    } else if (valuation_status === 'EXPENSIVE' && market_implied_growth <= gdpThreshold) {
      // Over-PESSIMISTIC catch: model calls it expensive, yet the market implies only modest growth.
      sanity_flags.push(
        `sanity_status_contradicts_evidence: model says valuation is EXPENSIVE, yet today's price implies only `
        + `~${(market_implied_growth * 100).toFixed(1)}% growth (at/below the ${(gdpThreshold * 100).toFixed(0)}% GDP rate) — the market `
        + `implies only modest growth, so "expensive" is hard to credit. Re-check.`,
      )
    }
  }

  // (d2) DIRECT self-coherence: the model's valuation_status vs its OWN proposed buy-below (in_buy_zone).
  // The model owns BOTH the qualitative label AND the buy-below number; when they disagree about TODAY's
  // price the read is internally incoherent (e.g. "EXPENSIVE" while the price is at/below the price it said
  // it would buy at). The (d/e) check above catches this only INDIRECTLY via market-implied growth — a
  // contradiction with normal-band implied growth would slip through. This is the direct check. Flag-only —
  // never blocks/clamps the verdict; the model owns the judgment, the human reconciles.
  if (in_buy_zone !== undefined && buy_below !== undefined && current_price !== undefined) {
    if (valuation_status === 'EXPENSIVE' && in_buy_zone === true) {
      sanity_flags.push(
        `sanity_status_contradicts_buy_zone: model labels the valuation EXPENSIVE, yet today's price `
        + `($${current_price.toFixed(2)}) is at/below its OWN proposed buy-below ($${buy_below.toFixed(2)}) — `
        + `the label and the buy threshold disagree about today's price. Reconcile (an over-pessimistic label, `
        + `or a buy-below set too high).`,
      )
    } else if (valuation_status === 'ATTRACTIVE' && in_buy_zone === false) {
      sanity_flags.push(
        `sanity_status_contradicts_buy_zone: model labels the valuation ATTRACTIVE, yet today's price `
        + `($${current_price.toFixed(2)}) is ABOVE its OWN proposed buy-below ($${buy_below.toFixed(2)}) — `
        + `it calls the price attractive but would not buy at it. Reconcile.`,
      )
    }
  }

  // (f) the model's proposed_buy_below implies (reverse-DCF at that price) an absurd growth.
  if (
    buy_below !== undefined
    && normalized_owner_earnings_per_share !== undefined
    && normalized_owner_earnings_per_share > 0
    && terminal_growth_rate !== undefined
  ) {
    const buyImplied = marketImpliedGrowth({
      price: buy_below,
      oe_ps: normalized_owner_earnings_per_share,
      terminal_g: terminal_growth_rate,
      discount,
      horizon: stage1HorizonForMoat(buffettMungerStrategy, moatClass),
    })
    if (buyImplied.status === 'solved' && buyImplied.implied_growth !== undefined && buyImplied.implied_growth > singleGrowthCap) {
      sanity_flags.push(
        `sanity_buy_below_implies_absurd_growth: the model's proposed buy-below ($${buy_below.toFixed(2)}) still implies `
        + `~${(buyImplied.implied_growth * 100).toFixed(1)}% growth (above the ${(singleGrowthCap * 100).toFixed(0)}% cap) — even at the "buy" `
        + `price the market would price in growth the method would refuse to underwrite.`,
      )
    }
  }

  // (g) implied EXIT multiple absurdity — DIRECTIONAL, flag-only. Too HIGH (> the fv_cap_multiple sane high
  // bound, 18×) → the live price requires exiting at a P/OE no defensible buyer would pay. The LOW direction
  // is fail-closed: a non-computable / non-positive multiple emits no field and no flag (handled above), so
  // there is no spurious low-side flag. Advisory only — never blocks the verdict, never clamps the valuation.
  if (implied_exit_multiple !== undefined && implied_exit_multiple > fvCapMultiple) {
    sanity_flags.push(
      `sanity_implied_exit_multiple_high: today's price implies an exit multiple of ${implied_exit_multiple.toFixed(1)}× owner-earnings `
      + `(> the ${fvCapMultiple}× sanity cap), well above a defensible exit — to merely earn the discount you would have to `
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
    && headline_growth > effective_growth_rate + DEMONSTRATED_HISTORY_MARGIN
  ) {
    sanity_flags.push(
      `sanity_assumed_growth_above_demonstrated_history: the model assumes ~${(headline_growth * 100).toFixed(1)}% near-term `
      + `growth — above the ~${(effective_growth_rate * 100).toFixed(1)}% demonstrated owner-earnings/share history `
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
    ? `buy_out_of_buy_zone: the model verdict is BUY with its OWN buy-below at $${buy_below.toFixed(2)} while `
      + `the live price is $${current_price.toFixed(2)} — above the model's own buy zone. Recorded as WATCH `
      + 'until the price enters the zone; the BUY thesis itself is preserved below for auditing.'
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
        : buyDataUnconfirmed
          ? ('RESEARCH_MORE' as const)
          : buyOutOfBuyZone
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
        : buyDataUnconfirmed
          ? `${buyClampReason} ${dec.analysis.decision_reason}`
          : buyOutOfZoneReason !== undefined
            ? `${buyOutOfZoneReason} ${dec.analysis.decision_reason}`
            : dec.analysis.decision_reason

  // ---- MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — Guard 1 + Guard 2 ----------------------------
  // GUARD 1: adequacy is an AUDIT judgment ONLY. NOTHING above (gatedVerdict / gatedReason / the moat gate /
  //   the buy-below) reads margin_of_safety or its adequacy — the verdict is identical whether adequacy is
  //   'adequate' or 'inadequate'. We carry the structured judgment verbatim onto the analysis payload below
  //   so the human can audit WHY the margin is adequate; it is never wired into any gate.
  // GUARD 2: a moat-SOURCED margin must rest on the GROUNDED moat thesis. The moat gate already fails closed
  //   on an ungrounded moat (a buy thesis cannot reach a passing verdict with an ungrounded moat), so a
  //   'moat' source on a gate-passing case is grounded by construction. Belt-and-suspenders: when 'moat' is
  //   claimed as a source we confirm the moat passed the grounded gate (moat_passes_gate AND not
  //   moat_grounding_unmet); if 'moat' is claimed but the moat is NOT grounded/gate-passing, that is
  //   incoherent (ungrounded moat = ungrounded margin) → surface a VISIBLE margin_of_safety_moat_ungrounded
  //   flag rather than silently accept a moat-sourced margin without a grounded moat.
  const marginOfSafetyJudgment = dec.analysis.margin_of_safety
  const marginRestsOnMoat = Array.isArray(marginOfSafetyJudgment?.sources)
    && marginOfSafetyJudgment.sources.includes('moat')
  const moatThesisGrounded = moat_passes_gate && !moat_grounding_unmet
  const margin_of_safety_moat_ungrounded = marginRestsOnMoat && !moatThesisGrounded

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
  // drivers count (an ungrounded driver is no justification). Runway reframe: the grounded runway thesis
  // (cite-verified headroom drivers) likewise contributes — only grounded {headroom, citation} drivers.
  const exceptionalityJustifications = [
    ...((judgment.moat?.moat_drivers ?? [])
      .filter((d) => d.grounded)
      .map((d) => ({ claim: d.advantage, citation_hash: d.citation }))),
    ...((judgment.runway?.runway_drivers ?? [])
      .filter((d) => d.grounded)
      .map((d) => ({ claim: d.headroom, citation_hash: d.citation }))),
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
    credited_growth_rate: effective_growth_rate,
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
      valuation_status: dec.analysis.valuation_status,
      next_required_action: moat_passes_gate ? dec.analysis.next_required_action : gatedReason,
      // MARGIN-OF-SAFETY AUDIT SURFACE — the model's forward-looking risk judgments (the SINGLE assumption
      // that, if wrong, breaks the thesis + the observable invalidating events). Carried verbatim from the
      // synthesis decision; required + substantive (schema + retry), deliberately NOT cite-gated.
      key_wrong_assumption: dec.analysis.key_wrong_assumption,
      thesis_break_triggers: dec.analysis.thesis_break_triggers,
      // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — the HEADLINE of the MoS audit surface: which
      // substitutable source(s) the margin rests on (price gap / moat durability / both), the per-source
      // reasoning, and a REASONED adequacy + reasoning. GUARD 1: adequacy is audit-only, never gates — the
      // verdict above is unchanged by it. Carried verbatim from synthesis; required + substantive (schema +
      // retry), deliberately NOT cite-gated. Projected under the distinct key margin_of_safety_judgment so it
      // never collides with the retired legacy `margin_of_safety` haircut string.
      ...(marginOfSafetyJudgment !== undefined ? { margin_of_safety_judgment: marginOfSafetyJudgment } : {}),
      // GUARD 2: a moat-sourced margin claimed on a NOT-grounded / NOT-gate-passing moat is incoherent
      // (ungrounded moat = ungrounded margin) — surfaced visibly, never silently accepted.
      ...(margin_of_safety_moat_ungrounded ? { margin_of_safety_moat_ungrounded: true } : {}),
      // Circle-of-competence judgment (in-competence here — the gate passed; the deep dive ran). Carried on
      // the analysis so the dossier always shows the grounded competence judgment that admitted this spend.
      circle_competence: circleJudgmentPayload,
      quick_screen: undefined, // populated below
      valuation: {
        moat_class: moatClass,
        moat_passes_gate,
        runway,
        ...(runway_exceptional ? { runway_exceptional } : {}),
        discount_rate: discount,
        // Discount provenance (Phase 1.4 / F.2): the COMPLIANT risk-free SAVINGS rate (app-config or the
        // config default) + the uniform equity premium. basis 'compliant_savings' when sourced from the
        // threaded app-config savings rate; 'config_default' when failed closed to savings_rate_default.
        discount_inputs: {
          risk_free_rate,
          risk_free_basis: risk_free_from_config ? 'compliant_savings' : 'config_default',
          equity_premium: buffettMungerStrategy.valuation.equity_premium,
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
        demonstrated_growth_reference: effective_growth_rate,
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
        ...(terminal_growth_rate !== undefined ? { terminal_growth_rate } : {}),
        roic,
        incremental_roic,
        incremental_roic_basis,
        reinvestment_rate,
        owner_earnings_bridge: bridge,
        owner_earnings_vs_fcf: ownerEarningsVsFcf,
        ...(normalized_owner_earnings_per_share !== undefined ? { normalized_owner_earnings_per_share } : {}),
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
        ...(implied_multiple !== undefined ? { implied_multiple } : {}),
        ...(terminal_value_pct_of_iv !== undefined ? { terminal_value_pct_of_iv } : {}),
        ...(cap_exceeded ? { cap_exceeded: true } : {}),
        // RELIGHTENED DECISION (R1): buy_price_per_share is the MODEL's proposed_buy_below (recorded
        // verbatim — NOT a derived FV). The band/gap engines no longer source it. proposed_buy_below
        // mirrors it as the explicit model-provenance field.
        ...(buy_below !== undefined ? { buy_price_per_share: buy_below, proposed_buy_below: buy_below } : {}),
        // Phase 2: the near-term growth TODAY'S PRICE implies (reverse-DCF) — the crazy-detector. Omitted
        // when no price.
        ...(market_implied_growth !== undefined ? { market_implied_growth } : {}),
        // RELIGHTENED DECISION (R1) — the deterministic sanity layer (flag-only, NEVER blocks the verdict):
        //   in_buy_zone          = pure arithmetic current_price <= buy_below;
        //   sanity_flags[]       = SYMMETRIC absurdity flags (over-optimistic + over-pessimistic catches);
        //   valuation_reasoning  = the MODEL's cited valuation basis (it shows its work).
        ...(in_buy_zone !== undefined ? { in_buy_zone } : {}),
        // implied_exit_multiple = current price / forward owner earnings (OE grown to the explicit horizon at
        // the MODEL's assumed growth; no discount-compounding factor) — the exit P/OE the live price requires;
        // a flag-only §2 sanity output (see the inline derivation above).
        ...(implied_exit_multiple !== undefined ? { implied_exit_multiple } : {}),
        ...(sanity_flags.length > 0 ? { sanity_flags } : {}),
        ...(dr !== undefined
          ? {
              valuation_reasoning: {
                owner_earnings_basis: dr.owner_earnings_basis,
                assumed_growth: dr.assumed_growth,
                assumed_growth_rationale: dr.assumed_growth_rationale,
                ...(dr.discount_rationale !== undefined ? { discount_rationale: dr.discount_rationale } : {}),
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
        // OE-bridge provenance: 'sec_edgar' (anchored to the 10-K) vs 'model_proposed'.
        bridge_basis,
        ...(bridge_fiscal_year !== undefined ? { bridge_fiscal_year } : {}),
        ...(bridge_source_id !== undefined ? { bridge_source_id } : {}),
        // SANITY-CHECK REFERENCE: the deterministic Greenwald/D&A maintenance-capex proxy ($M). NOT the
        // binding OE input (the model judges maintenance capex); surfaced for the human + the advisory
        // divergence flag (maintenance_capex_below_proxy). Omitted when the EDGAR series is too thin.
        ...(maintenance_capex_proxy_reference !== undefined
          ? { maintenance_capex_proxy_reference }
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
      // Mechanism 5: red-team layer — strongest objection + the synthesis response (answered-with-evidence
      // vs accepted→downgraded), plus the deterministic red_team_objection_unaddressed / red_team_incomplete
      // flags. Surfaced in the verdict/dossier so an unaddressed strong objection is never silently dropped.
      red_team: redTeamLayer,
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

  // Resolve shariah status from ledger (quick screen event stored there)
  // We need to recover the quick-screen analysis — re-read from ledger or use an in-memory flag.
  // Since this function can be called independently, we re-read the quick-screen event.
  const qsEventFromStore = (await store.list()).find(
    (e) => e.event_id === command.quick_screen_event_id,
  )
  const qsPayload = qsEventFromStore?.payload as Record<string, unknown> | undefined
  const rawShariahStatus = qsPayload?.['shariah_status'] as 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'PENDING' | undefined
  // Lane-proposed (quick-screen) fallback status.
  const laneShariahStatus: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN' =
    rawShariahStatus === 'COMPLIANT' ? 'COMPLIANT'
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

  const analysisFinalPayload = {
    ...(analysisEvent.payload as Record<string, unknown>),
    shariah_status: analysisShariahStatusForPhase,
    quick_screen: {
      summary: String(qsPayload?.['summary'] ?? ''),
      business_quality: String(qsPayload?.['business_quality'] ?? ''),
      moat: String(qsPayload?.['moat'] ?? ''),
      management_capital_allocation: String(qsPayload?.['management_capital_allocation'] ?? ''),
      financial_quality: String(qsPayload?.['financial_quality'] ?? ''),
      valuation_sanity: String(qsPayload?.['valuation_sanity'] ?? ''),
      screening_result: String(qsPayload?.['screening_result'] ?? ''),
      confidence: String(qsPayload?.['confidence'] ?? ''),
    },
  }

  const analysis = await store.append({ ...analysisEvent, payload: analysisFinalPayload })

  // Mechanism 5: when synthesis ACCEPTED the red-team objection and downgraded, record the downgrade in
  // the verdict rationale (the verdict format gains the red-team objection + the synthesis response).
  const redTeamDowngrade = redTeamLayer.synthesis_response?.mode === 'accepted_downgraded'
    ? redTeamLayer.synthesis_response.downgrade
    : undefined
  const redTeamReasonNote = redTeamDowngrade !== undefined
    ? ` Red-team accepted → downgraded ${redTeamDowngrade.dimension} (${redTeamDowngrade.from} → ${redTeamDowngrade.to}): ${redTeamLayer.synthesis_response?.text ?? ''}`
    : redTeamLayer.objection_unaddressed === true
      ? ` Red-team strongest objection UNADDRESSED by synthesis — see open questions.`
      : ''

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
      ...baseRateCaveats,
      ...degradedFlags,
      // Dual-model cross-check disagreements → automatic human escalation (conservative answer holds).
      ...crossCheckOpenQuestions,
      ...(redTeamOpenQuestion !== undefined ? [redTeamOpenQuestion] : []),
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
