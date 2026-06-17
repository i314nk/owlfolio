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
import { groundProposedSources, type CapturedSource, type GroundingDeps, type ProposedSource, type SourcePolicyRejection } from './sourceGrounding'
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
import { computeIncrementalRoic, demonstratedOwnerEarningsGrowth, estimateMaintenanceCapex, maintenanceCapexLowConfidence, type Fundamentals, type SecEdgarDeps } from './secEdgar'
import { resolveFundamentalsForTicker } from './fundamentalsProvider'
import { evaluateBaseRateBurden, type BaseRateBurdenFlag } from './baseRateBurden'
import { BASE_RATES } from '@owlfolio/strategies/baseRates'
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
import { ingestManualSourceBundle } from './sourceLedger'
import { resolveResearchStrategyRef } from './researchStrategyRef'
import { buffettMungerStrategy, creditedGrowth, discountRate, moatPassesGate, stage1HorizonForMoat, terminalGrowthForMoat, twoStageValuation, widenedMarginOfSafety } from '@owlfolio/strategies/buffettMunger'
import { computeShariahFinancialRatios } from '@owlfolio/strategies/shariahFinancialRatios'
import { valuationSensitivity, type ValuationSensitivity } from '@owlfolio/strategies/valuationSensitivity'
import { marketImpliedGrowth } from '@owlfolio/strategies/reverseDcf'
import { sustainableGrowthBand } from '@owlfolio/strategies/sustainableGrowthBand'
import { requiredGrowthGap } from '@owlfolio/strategies/requiredGrowthGap'
import { fetchAverageMarketCap, fetchTenYearTreasuryYield, resolveCurrentPrice, type AverageMarketCapResult, type MarketDataDeps, type PriceQuote, type TreasuryYieldResult } from './marketData'
import { runRedTeamPass, runRedTeamResponsePass, buildRedTeamLayer, type RedTeamLaneDigest, type RedTeamResult } from './redTeamPass'
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
  ShariahLaneSchema,
  DecisionAgentSchema,
  MoatCrossCheckSchema,
  ShariahCrossCheckSchema,
  AGENT_TIMEOUT_MS,
  MOAT_RUBRIC_PROMPT,
  SHARIAH_OVERLAY_PROMPT,
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
  buildPrimaryFilingBlock,
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
  /** SHARIAH lane only: its sector/impermissible-income overlay (harness recomputes the ratios). */
  shariah_judgment?: ShariahLaneJudgment
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
  /** model-tiering: optional per-role provider/model overrides (registry). Omitted = single-provider default. */
  model_overrides?: Partial<Record<ModelRoleId, ModelRoleOverride>>
  /**
   * model-tiering: the env source the registry reads `OWLFOLIO_MODEL_ROLE_<ROLE>` from (env FILE merged
   * over process.env, file wins). Omitted = `process.env` (historical default).
   */
  model_role_env?: Record<string, string | undefined>
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function swarmSeg(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
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
   * Override the live 10y Treasury-yield resolver (Phase 1.4). The discount = live Treasury + a fixed
   * uniform equity premium (global config, never agent-set). Defaults to the live Yahoo ^TNX adapter
   * outside offline test mode; fail-closed to the config default Treasury exactly like the other resolvers.
   */
  resolveTreasuryYield?: (deps?: MarketDataDeps) => Promise<TreasuryYieldResult>
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
 * Resolve the live 10y Treasury yield (decimal) for the discount anchor (Phase 1.4), fail-closed and
 * test-mode-gated. Returns undefined when offline / no resolver / the live fetch failed (in which case
 * `discountRate` falls back to the config default Treasury). The discount stays GLOBAL config; this only
 * swaps the documented default for the live yield when one is available. Never throws.
 */
async function resolveTreasuryYieldValue(deps: FundamentalsDeps): Promise<number | undefined> {
  const resolver = deps.resolveTreasuryYield
    ?? (isOfflineTestMode() ? undefined : ((d?: MarketDataDeps) => fetchTenYearTreasuryYield(d)))
  if (resolver === undefined) return undefined
  try {
    const r = await resolver()
    return r.available ? r.yield : undefined
  } catch {
    return undefined
  }
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
  const accumulated = new Map<string, CapturedSource>()
  const remember = (captured: CapturedSource[]) => captured.forEach((c) => accumulated.set(c.source_id, c))

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
  try {
    qs = await runGroundedAgentWithRetry(quickScreenRuntime.provider, {
    run_id: `run_${command.research_case_id}_quick_screen`,
    model_id: quickScreenRuntime.model_id,
    prompt: `You are the Buffett-Munger quick-screen gate agent for ${command.ticker} (${command.company_id}). `
      + `This is a two-step gate — NOT a full analysis. Keep responses brief; the deep dive handles detail.\n\n`
      + `STEP 1 — Shariah permissibility: assess whether the company's primary business is permissible under `
      + `Islamic finance principles. If the core business is clearly haram (e.g. conventional banking, alcohol, `
      + `weapons, tobacco, adult content), set shariah_status to 'NON_COMPLIANT' and screening_result to 'reject'. `
      + `If the business is clearly halal or the status is uncertain/conditional, set shariah_status accordingly `
      + `('COMPLIANT', 'CONDITIONAL', or 'PENDING') and continue to step 2.\n\n`
      + `STEP 2 (only if not NON_COMPLIANT) — Business quality worth-investigating check: is this company `
      + `worth a deep dive under Buffett-Munger criteria? If clearly inadequate (e.g. no durable business, `
      + `chronic losses, terminal industry), set screening_result to 'reject'. Otherwise set screening_result `
      + `to 'deep_dive_candidate'.\n\n`
      + `Return a brief assessment in each field. Do NOT perform per-dimension deep analysis — that is the deep dive's job. `
      + `Gather primary/secondary sources and return them in proposed_sources with real URLs.`,
    timeout_ms: AGENT_TIMEOUT_MS,
    schema_name: 'BuffettMungerQuickScreen',
    }, QuickScreenAgentSchema, deps)
  } catch (error) {
    // Quick-screen retry exhausted: fail the run cleanly (no lanes ran yet) rather than throw a raw
    // provider/timeout error past the swarm boundary. The worker records this as research_run_failed.
    throw new ResearchSwarmStageError('quick_screen', error, { lanes_completed: false })
  }
  remember(qs.captured)

  // I1: fail-closed if quick screen produced no verifiable sources
  if (qs.verified_ids.length === 0) {
    throw new Error(`Quick screen for ${command.ticker} produced no verifiable sources (fail-closed).`)
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
        sources: capturedSoFar.map((c) => ({
          source_id: c.source_id,
          kind: 'url' as const,
          title: c.title,
          url: c.url,
          excerpt: c.excerpt,
          availability: c.availability,
          ...(c.content_hash === undefined ? {} : { content_hash: c.content_hash }),
          metadata: {
            research_case_id: command.research_case_id,
            ...(c.http_status === undefined ? {} : { http_status: c.http_status }),
          },
        })),
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
        sources: capturedSoFar.map((c) => ({
          source_id: c.source_id,
          kind: 'url' as const,
          title: c.title,
          url: c.url,
          excerpt: c.excerpt,
          availability: c.availability,
          ...(c.content_hash === undefined ? {} : { content_hash: c.content_hash }),
          metadata: {
            research_case_id: command.research_case_id,
            ...(c.http_status === undefined ? {} : { http_status: c.http_status }),
          },
        })),
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

export async function runResearchDeepDivePhase(
  store: SwarmStore,
  provider: Provider,
  command: RunResearchDeepDivePhaseCommand,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number; maxToolCalls?: number; accumulated?: Map<string, CapturedSource> } & FundamentalsDeps = {},
) {
  const strategyRef = resolveResearchStrategyRef(command)
  const accumulated = deps.accumulated ?? new Map<string, CapturedSource>()
  const remember = (captured: CapturedSource[]) => captured.forEach((c) => accumulated.set(c.source_id, c))

  const lanes = buffettMungerDeepDiveLanes

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

  // ---- Pre-fetch SEC EDGAR primary-filing fundamentals (fail-closed, test-mode-gated) ----
  // When fundamentals resolve, we ground the latest 10-K as a verified primary source and inject the
  // raw filing numbers into the financial_quality / valuation / shariah lanes so those lanes ground on
  // filings instead of dropping when IR/news is blocked. When they do not resolve (non-US ticker,
  // EDGAR down, test mode w/o injection), the lanes run EXACTLY as today — no regression.
  const fundamentals = await resolveFundamentals(command.ticker, deps)
  let primaryFilingBlock: string | undefined
  let primaryFilingSourceId: string | undefined
  if (fundamentals !== undefined) {
    const tenK = fundamentals.filings.find((x) => x.form === '10-K')
    if (tenK !== undefined) {
      const sourceId = `sec_edgar_10k_${fundamentals.cik}_fy${fundamentals.latest_annual.fiscal_year}`
      const proposed: ProposedSource = {
        source_id: sourceId,
        title: `${fundamentals.entity_name} 10-K (FY${fundamentals.latest_annual.fiscal_year}) — SEC EDGAR`,
        url: tenK.url,
        excerpt: `Primary SEC EDGAR 10-K filing for ${fundamentals.entity_name} (CIK ${fundamentals.cik}), filed ${tenK.filed}.`,
      }
      // Ground the 10-K through the same path as model-proposed sources (content-hash + SSRF guard).
      const ground = deps.ground ?? groundProposedSources
      const grounded = await ground([proposed], deps.grounding)
      const captured = grounded.captured[0]
      if (captured !== undefined && grounded.verified_ids.includes(sourceId)) {
        remember([captured])
        primaryFilingSourceId = sourceId
        primaryFilingBlock = buildPrimaryFilingBlock(fundamentals, sourceId)
      }
    }
  }

  // ---- Per-lane swarm ----
  const laneResults = await runLaneSwarm(lanes, async (lane) => {
    // Inject the grounded primary-filing block into the financial-heavy lanes so they have a
    // guaranteed primary citation + real numbers. The lane MUST cite the EDGAR source_id.
    const injectFiling = primaryFilingBlock !== undefined && PRIMARY_FILING_LANES.has(lane)
    // model-tiering: the highest-stakes lanes resolve their OWN registry role (moat → lane_moat,
    // shariah → lane_shariah); every other lane uses lanes_default. Default = the run's provider/model
    // so single-provider runs are unchanged; an override can pin moat/shariah onto a stronger model.
    const laneRole: ModelRoleId = lane === 'moat' ? 'lane_moat' : lane === 'shariah' ? 'lane_shariah' : 'lanes_default'
    const laneRuntime = resolveRoleRuntime(laneRole, provider, command)
    const sourceDiscipline = lane === 'risks'
      ? `As the RISKS lane you may cite anything — knowing the consensus IS the job.`
      : lane === 'management'
        ? `Cite filings, proxies (DEF 14A), transcripts, and insider-trading data; media profiles will be rejected.`
        : lane === 'shariah'
          ? `Cite filings, segment disclosures, and Shariah screening providers; sell-side/media will be rejected.`
          : `Cite filings, transcripts, regulatory/statistical data, and company disclosures; sell-side research, financial media, investor write-ups, and blogs will be rejected.`
    const basePrompt = `You are the Buffett-Munger ${lane} specialist agent for ${command.ticker}. `
      + `Produce a source-backed finding for the ${lane} lane only. Gather your own sources; return them in proposed_sources with real URLs. `
      + `SOURCE DISCIPLINE (Mechanism 6): this lane reasons from PRIMARY documents. ${sourceDiscipline}`
      + (injectFiling ? primaryFilingBlock : '')

    const baseRunId = `run_${command.research_case_id}_${swarmSeg(lane)}`
    // The grounded EDGAR 10-K is a guaranteed verified primary citation for the injected lanes —
    // include it in the lane's verified_ids so the lane records a finding even if the model proposed
    // no other verifiable source (this is what fixes the lane-drop when IR/news is blocked).
    const withFiling = (verified: string[]) =>
      injectFiling && primaryFilingSourceId !== undefined
        ? [...new Set([primaryFilingSourceId, ...verified])]
        : verified

    // ---- MOAT lane: emits its OWN moat_rubric + runway_rubric (spec-correct decomposition) ----
    // The judgment-objectivity spec assigns rubric scoring to the producing lane. The moat lane runs
    // under runValidatedAgent with moat_rubric + runway_rubric REQUIRED — the retry FORCES them; only
    // after 2 fails does the visible holistic fallback (judgment_degraded: rubric_not_emitted) apply.
    if (lane === 'moat') {
      const moatRequired: RequiredFieldCheck<z.infer<typeof MoatLaneSchema>>[] = [
        { name: 'moat_rubric', present: (a) => a.moat_rubric !== undefined, hint: 'scored 0/1/2 rubric_scores + proposed_tier + citation_hash on cited rows' },
        { name: 'runway_rubric', present: (a) => a.runway_rubric !== undefined, hint: 'scored 0/1/2 rubric_scores + proposed_tier' },
      ]
      const validated = await runValidatedAgent(laneRuntime.provider, {
        run_id: baseRunId,
        model_id: laneRuntime.model_id,
        prompt: basePrompt + MOAT_RUBRIC_PROMPT,
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerMoatLane',
      }, MoatLaneSchema, {
        ...deps,
        lane,
        requiredFields: moatRequired,
        useToolLoop: true,
        ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
      })
      const agent = validated.status === 'ok' ? validated.result : validated.lastResult
      if (agent === undefined) {
        // No payload parsed even after retries — treat as a failed lane (runLaneSwarm marks it incomplete).
        throw new Error(`Moat lane produced no parseable output: ${validated.status === 'failed' ? validated.reason : 'unknown'}`)
      }
      remember(agent.captured)
      const a = agent.analysis
      const moat_judgment: MoatLaneJudgment = {
        moat_class: a.moat_class,
        runway: a.runway,
        ...(a.runway_exceptional !== undefined ? { runway_exceptional: a.runway_exceptional } : {}),
        ...(a.moat_rubric !== undefined ? { moat_rubric: a.moat_rubric } : {}),
        ...(a.runway_rubric !== undefined ? { runway_rubric: a.runway_rubric } : {}),
      }
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

    // ---- SHARIAH lane: emits its OWN sector_status + impermissible_income overlay ----
    // The harness recomputes the AAOIFI ratios from EDGAR + market cap + this lane-supplied
    // impermissible_income. Required under runValidatedAgent; after 2 fails → shariah_ratios_unverified.
    if (lane === 'shariah') {
      const shariahRequired: RequiredFieldCheck<z.infer<typeof ShariahLaneSchema>>[] = [
        { name: 'sector_status', present: (a) => a.sector_status !== undefined, hint: "'compliant' | 'conditional' | 'non_compliant' confirmed with segment revenue" },
        { name: 'impermissible_income', present: (a) => a.impermissible_income !== undefined, hint: 'non-permissible income in $MILLIONS (0 if fully permissible)' },
      ]
      const validated = await runValidatedAgent(laneRuntime.provider, {
        run_id: baseRunId,
        model_id: laneRuntime.model_id,
        prompt: basePrompt + SHARIAH_OVERLAY_PROMPT,
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerShariahLane',
      }, ShariahLaneSchema, {
        ...deps,
        lane,
        requiredFields: shariahRequired,
        useToolLoop: true,
        ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
      })
      const agent = validated.status === 'ok' ? validated.result : validated.lastResult
      if (agent === undefined) {
        throw new Error(`Shariah lane produced no parseable output: ${validated.status === 'failed' ? validated.reason : 'unknown'}`)
      }
      remember(agent.captured)
      const a = agent.analysis
      // Only surface the overlay when BOTH required fields are present (a schema-valid live model always
      // has them; the fallback path leaves shariah_judgment undefined → shariah_ratios_unverified flag).
      const overlayPresent = a.sector_status !== undefined && a.impermissible_income !== undefined
      return {
        lane,
        finding_summary: a.finding_summary,
        confidence: a.confidence,
        caveats: a.caveats,
        verified_ids: withFiling(agent.verified_ids),
        ...(overlayPresent ? { shariah_judgment: { sector_status: a.sector_status, impermissible_income: a.impermissible_income } } : {}),
        ...(agent.policy_rejections.length > 0 ? { policy_rejections: agent.policy_rejections } : {}),
        ...(validated.status === 'failed'
          ? { judgment_retry_degraded: `shariah_lane_schema_retry_exhausted: the model omitted [${validated.missing.join(', ')}] after ${validated.attempts} attempts (${validated.reason}).` }
          : {}),
      }
    }

    // ---- Generic lanes (financial_quality, valuation, management, risks, …) ----
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
  const shariahLaneResult = laneResults.find((l) => l.lane === 'shariah')
  const moatJudgment = moatLaneResult?.moat_judgment
  const shariahLaneJudgment = shariahLaneResult?.shariah_judgment

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
    if (s.content_hash !== undefined) verifiedCitationHashes.add(s.content_hash)
    verifiedCitationHashes.add(s.source_id) // a lane may cite by source_id; both are corpus-verified
  }
  const judgment = resolveJudgmentTiers({
    ...(moatJudgment?.moat_rubric !== undefined ? { moatRubric: moatJudgment.moat_rubric } : {}),
    ...(moatJudgment?.runway_rubric !== undefined ? { runwayRubric: moatJudgment.runway_rubric } : {}),
    // Holistic fallbacks (the moat lane's holistic fields) so the resolved tier is NEVER undefined when
    // the rubric is omitted — closing the silent-degradation cascade the live dogfood exposed.
    ...(moatJudgment?.moat_class !== undefined ? { holisticMoatClass: moatJudgment.moat_class } : {}),
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

  // ---- Mechanism 5: Red-Team Pass (after the 7 lanes, BEFORE synthesis) ----
  // One adversarial grounded agent whose ONLY mandate is to break the case. It receives a compact
  // digest of the lane findings + the mechanically-computed anchor tiers + the verified source corpus,
  // and cites the SAME corpus (it is the consensus-knowing lane — allowed all source categories). Its
  // strongest objection is cite-checked; synthesis is then OBLIGED to answer it or downgrade. A
  // red-team timeout DEGRADES (red_team_incomplete) — the run continues so a completed 7-lane deep dive
  // is never discarded. model-tiering-spec: the red team now resolves the `red_team` registry role —
  // when an override pins a DIFFERENT provider/model it genuinely runs on a different model than the
  // lanes (catches shared-narrative error single-model cross-checks cannot). Default = the run's model.
  const redTeamRuntime = resolveRoleRuntime('red_team', provider, command)
  const corpusBeforeSynthesis = [...accumulated.values()]
  const corpusHashesBeforeSynthesis = new Set<string>()
  for (const s of corpusBeforeSynthesis) {
    if (s.content_hash !== undefined) corpusHashesBeforeSynthesis.add(s.content_hash)
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
  // A live red-team objection (survived cite-check) makes a red-team RESPONSE required — produced by the
  // dedicated runRedTeamResponsePass below (the focused decomposition), NOT by the synthesis schema.
  const redTeamObjectionLive = redTeam.status === 'complete' && redTeam.strongest_objection.citations.length > 0
  // Spec-correct decomposition: the moat/runway rubric + the Shariah overlay are produced + retried on their
  // OWN specialist lanes, and the red-team response on its OWN focused call (below). Synthesis therefore has
  // NO judgment-overlay required fields — it just produces the verdict/thesis/valuation/Shariah rationale.
  const synthesisRequiredFields: RequiredFieldCheck<z.infer<typeof DecisionAgentSchema>>[] = []
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
      + `REQUIRED — do not omit: report incremental_roic (normalized INCREMENTAL ROIC as a fraction, e.g. 0.20) alongside reinvestment_rate. The harness credits growth only when incremental_roic exceeds 10%; historical revenue/EPS growth is never an input. `
      // The moat/runway classification + rubrics and the Shariah overlay are produced by the MOAT and
      // SHARIAH specialist lanes — NOT here. The harness has already resolved them; the resolved tiers are
      // handed to you below for RECONCILIATION only (you do not re-score them).
      + `The MOAT lane resolved moat_class='${judgment.moat!.resolved_moat_class}' and reinvestment runway='${judgment.runway!.resolved_runway}'`
      + (shariahLaneJudgment !== undefined ? `; the SHARIAH lane assessed sector_status='${shariahLaneJudgment.sector_status}'` : '')
      + `. Reconcile your verdict + rationale with these resolved classifications; do NOT re-score the rubrics. `
      + `Cite sources in proposed_sources with real URLs.`
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
  //   raises g_t). Flat 10% discount, always.
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
  // The dedicated red-team-response call exhausted its retries (the focused decomposition's own visible
  // fallback) — surfaced so the gap is seen; the red_team_objection_unaddressed open question is also set.
  if (redTeamResponseDegraded !== undefined) {
    degradedFlags.push(redTeamResponseDegraded)
  }
  // Per-lane schema-retry exhaustion (the moat/shariah lane omitted its REQUIRED judgment block after 2
  // attempts) — surfaced exactly like the synthesis path so the gap is visible, not silent.
  if (moatLaneResult?.judgment_retry_degraded !== undefined) degradedFlags.push(moatLaneResult.judgment_retry_degraded)
  if (shariahLaneResult?.judgment_retry_degraded !== undefined) degradedFlags.push(shariahLaneResult.judgment_retry_degraded)
  if (judgment.moat?.judgment_degraded === 'rubric_not_emitted' || judgment.runway?.judgment_degraded === 'rubric_not_emitted') {
    degradedFlags.push(
      'judgment_degraded: rubric_not_emitted — the model omitted the moat/runway rubric_scores; the moat '
      + 'class and reinvestment runway were resolved from the holistic lane judgment (or a conservative default), '
      + 'NOT from scored, citation-verified rubric rows.',
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
    // Phase 1.2/1.7: maintenance capex DEFAULTS to the conservative dual proxy (Greenwald vs D&A floor)
    // computed over the EDGAR series — the harness's honest figure. When the series is too thin for either
    // proxy, fall back to the legacy min(D&A, capex × model tier). The model tier can argue DOWN (a lower
    // maint capex → higher OE), but only via min(): it never lifts maint capex above the conservative proxy.
    const dualMaint = fundamentals?.annual_series !== undefined
      ? estimateMaintenanceCapex(fundamentals.annual_series).maintenance_capex
      : undefined
    const legacyMaint = Math.min(edgar_d_and_a, edgar_capex * maintenance_fraction)
    maintenance_capex = dualMaint !== undefined ? dualMaint : legacyMaint
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

  // Discount = live 10y Treasury (fail-closed to the config default) + the fixed uniform equity premium
  // (Phase 1.4 / Step 3). GLOBAL config, never an agent input, no quality knob.
  // ANCHOR-SWAP-F2: discount anchor = Treasury + equity_premium today; F.2 swaps to savings_rate + equity_premium (deferred, blocked on the calibration cohort #124).
  const ten_year_treasury = await resolveTreasuryYieldValue(deps)
  const discount = discountRate(buffettMungerStrategy, ten_year_treasury)
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
  let buy_price_per_share: number | undefined
  let fair_value_per_share: number | undefined
  let implied_multiple: number | undefined
  let margin_of_safety: number | undefined
  let terminal_growth_rate: number | undefined
  let terminal_value_pct_of_iv: number | undefined
  let cap_exceeded = false
  let margin_of_safety_widening_reasons: string[] = []
  // Phase 2 (reverse-DCF + sensitivity wiring): a low/base/high fair-value RANGE and the cap-binding
  // flag. Computed inside the valuation block when a point FV is produced; market-implied growth is
  // computed later (needs the resolved current price). Presentation/attachment only — no math change.
  let valuationSensitivityResult: ValuationSensitivity | undefined
  let fair_value_range: string | undefined
  let fair_value_range_basis: string | undefined
  let valuation_cap_binding: boolean | undefined

  // Maintenance-capex confidence (Phase 1.2 → 1.6 widening input, review "bite once"): low confidence is
  // genuine estimation DISPERSION — BOTH proxies computed but disagree materially — NOT the D&A-floor
  // fallback from missing gross PP&E. That fallback already made the cash flow conservative (higher maint
  // capex → lower owner earnings), so widening the MoS on top would haircut the same single cause twice.
  const low_maint_capex_confidence = fundamentals?.annual_series !== undefined
    ? maintenanceCapexLowConfidence(fundamentals.annual_series)
    : false

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
  // Phase 2 sensitivity inputs: usable owner-earnings history depth + whether the robust slope diverged
  // from the Theil–Sen cross-check (high dispersion). Both widen the fair-value band (honest uncertainty).
  const demonstrated_points_used = demonstratedGrowthResult?.points_used ?? 0
  const demonstrated_high_dispersion =
    demonstratedGrowthResult?.flags.some((f) => /dispersion/i.test(f)) ?? false
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
      'valuation_degraded: credited_growth_floored_g0 — the demonstrated owner-earnings/share CAGR was '
      + 'unavailable or non-positive, so growth was floored to g=0 (honest no-growth floor). The two-stage '
      + 'DCF still computed; treat the fair value as a no-growth floor.',
    )
  }

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
    // Phase 1.5/1.6: rich two-stage valuation — surfaces terminal_value_pct_of_iv, flags cap_exceeded
    // (no silent truncation), and discards only an absurd (units-bug) value.
    const valuation = twoStageValuation({
      oe_ps: normalized_owner_earnings_per_share,
      g: effective_growth_rate,
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
      fair_value_per_share = computedFairValue
      terminal_growth_rate = terminal_g
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
      // Phase 1.6: ONE end-stage margin-of-safety knob, widened by the documented uncertainties.
      const widened = widenedMarginOfSafety(buffettMungerStrategy, {
        moat_class: moatClass,
        terminal_value_pct_of_iv,
        low_maint_capex_confidence,
        // Above-GDP growth IS a moat-durability claim (Phase 1.3 coupling) → weak-durability widening.
        weak_moat_durability: growthResult.above_gdp,
      })
      margin_of_safety = widened.margin_of_safety
      margin_of_safety_widening_reasons = widened.widening_reasons
      // NOTE: buy_price_per_share is NO LONGER fair_value × (1 − MoS). The valuation-core revision (V3)
      // moved the buy decision to implied-growth-vs-band, so the buy-below is now the PRICE at which the
      // market-implied growth rises to the buy-threshold (band_low − required_gap). It is derived below,
      // once the sustainable-growth band and required gap are computed (see the verdict-band section).

      // ---- Phase 2: sensitivity RANGE around the point FV (attachment/presentation only) ----
      // A low/base/high fair-value band straddling the CREDITED growth, widened by the growth measure's
      // own uncertainty (thin history / dispersion). We pass the SAME oe_ps, terminal, discount and
      // horizon the point valuation used so the band's base equals fair_value_per_share. The math (cap,
      // fade, MoS, discount) is unchanged — this only describes the uncertainty already present.
      valuationSensitivityResult = valuationSensitivity(buffettMungerStrategy, {
        oe_ps: normalized_owner_earnings_per_share,
        demonstrated_growth,
        points_used: demonstrated_points_used,
        high_dispersion: demonstrated_high_dispersion,
        terminal_g,
        discount,
        horizon,
      })
      valuation_cap_binding = valuationSensitivityResult.cap_binding
      if (
        valuationSensitivityResult.computable
        && valuationSensitivityResult.fair_value_low !== undefined
        && valuationSensitivityResult.fair_value_base !== undefined
        && valuationSensitivityResult.fair_value_high !== undefined
      ) {
        const lo = Math.round(valuationSensitivityResult.fair_value_low)
        const base = Math.round(valuationSensitivityResult.fair_value_base)
        const hi = Math.round(valuationSensitivityResult.fair_value_high)
        fair_value_range = `$${lo}–$${hi} (base $${base})`
        // Honest "why is the range wide" note: a wide band (≳40%) driven by thin usable owner-earnings
        // history and/or dispersion → say so, so a thin-history name reads as uncertain, not precise.
        const rangePct = valuationSensitivityResult.range_pct
        const pts = valuationSensitivityResult.uncertainty.points_used
        if (rangePct !== undefined && rangePct >= 0.40) {
          const causes: string[] = []
          if (pts > 0 && pts < 8) causes.push(`only ${pts} years of usable owner-earnings history`)
          if (valuationSensitivityResult.uncertainty.high_dispersion) causes.push('high growth dispersion')
          fair_value_range_basis = causes.length > 0
            ? `Range is wide (±${Math.round((rangePct / 2) * 100)}%) because ${causes.join(' and ')} anchor the growth estimate — treat it as honestly uncertain, not precise.`
            : `Range spans ±${Math.round((rangePct / 2) * 100)}% — treat the base as a central estimate, not a precise target.`
        }
      }
    }
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
  let market_implied_growth: number | undefined
  if (
    current_price !== undefined
    && fair_value_per_share !== undefined
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
  // Spec-correct decomposition: the overlay now comes from the SHARIAH lane output, not the synthesis schema.
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
      }
    | undefined
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
      impermissible_income: shariahJudgment.impermissible_income,
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

  // ---- Reverse-DCF vs sustainable-growth band ± required-gap → verdict band (valuation-core revision) ----
  // The verdict no longer compares the live price to a point fair value (price-vs-FV). It compares the
  // market-IMPLIED growth (what TODAY'S price assumes the business will compound at, reverse-DCF) against a
  // grounded, GDP-honest sustainable-growth band, with conservatism living in ONE place: the required gap.
  //
  // Two pure engines (no conservatism in the band; ALL conservatism in the gap — F.13 one-knob discipline):
  //   band = sustainableGrowthBand(...)  → band_low / band_center / band_high (what the business can FUND).
  //   gap  = requiredGrowthGap(...)      → required_gap in GROWTH-RATE POINTS (the SAME widening factors the
  //                                        MoS price-haircut used — reuse the widenedMarginOfSafety args 1:1).
  //
  // Boundaries (implied = market_implied_growth, lo = band.band_low, gapv = gap.required_gap):
  //   implied <= lo - gapv            → BUY-WINDOW  (market UNDERPRICES sustainable growth = CHEAP — note the
  //                                                   direction: LOW implied growth vs a HIGHER honest band is
  //                                                   the cheap case, not the expensive one.)
  //   lo - gapv < implied <= lo       → WATCH-FAIR  (within the honest band, no safety gap — human-discretion
  //                                                   zone; NEVER auto-escalates to BUY.)
  //   implied > lo                    → WATCH       (fairly-to-richly priced); sub-flag implied_above_band
  //                                                   when implied >= band_high (market prices ABOVE what the
  //                                                   business sustains).
  // Fail-closed: when implied is undefined, the band is not_computable, or OE<=0 (no point FV / no band),
  // verdict_state stays undefined and the buy-band-unconfirmed clamp below forces a safe non-BUY verdict.
  const band = sustainableGrowthBand(buffettMungerStrategy, {
    incremental_roic,
    reinvestment_rate,
    demonstrated_growth,
    runway,
    moat_class: moatClass,
    incremental_roic_basis,
    // capital_light_argument arrives from the valuation lane in a later slice (V5); OMITTED here clamps the
    // band to the reinvestment×ROIC identity (the honest default), which is fine for now.
  })
  const gap = requiredGrowthGap(buffettMungerStrategy, {
    // Mirror the widenedMarginOfSafety args 1:1 (the SAME documented uncertainties widen the gap).
    moat_class: moatClass,
    ...(terminal_value_pct_of_iv !== undefined ? { terminal_value_pct_of_iv } : {}),
    low_maint_capex_confidence,
    // Above-GDP growth IS a moat-durability claim (Phase 1.3 coupling) → weak-durability widening.
    weak_moat_durability: growthResult.above_gdp,
  })

  // ---- buy-below = price where market-implied growth meets the buy-threshold; fair_value = band center ----
  // The monotonic forward DCF (twoStageValuation, increasing in g) is REPURPOSED as a price-from-growth
  // function (V2 of the valuation-core revision):
  //   buy_price_per_share  = forward DCF at g = band_low − required_gap (the buy-threshold). This is, by
  //                          construction, the price at which the reverse-DCF market-implied growth rises to
  //                          exactly band_low − required_gap — i.e. the cheapest price that still clears the
  //                          buy gate. It REPLACES the old fair_value × (1 − MoS) haircut.
  //   fair_value_per_share = forward DCF at g = band_center. PRESENTATION-ONLY reference anchor; it is NOT
  //                          the decision driver — the verdict is implied-growth-vs-band (V3), not price-vs-FV.
  // Both reuse the SAME twoStageValuation arg basis the point FV used (oe_ps, terminal_g, discount,
  // ceiling_multiple, horizon; fade_years defaults to the config growth_fade_years, as the point FV and the
  // reverse-DCF solve both do — keeping forward/reverse round-trip-consistent). Fail-closed: only when a
  // point FV exists (positive OE/share, moat investable, FV not discarded) AND the band/gap are computable.
  if (
    fair_value_per_share !== undefined
    && terminal_growth_rate !== undefined
    && normalized_owner_earnings_per_share !== undefined
    && normalized_owner_earnings_per_share > 0
    && band.grounding_status !== 'not_computable'
    && Number.isFinite(band.band_center)
    && Number.isFinite(band.band_low)
    && Number.isFinite(gap.required_gap)
  ) {
    const valHorizon = stage1HorizonForMoat(buffettMungerStrategy, moatClass)
    // fair_value: presentation-only band-center reference (NOT the decision driver).
    const fvAtCenter = twoStageValuation({
      oe_ps: normalized_owner_earnings_per_share,
      g: band.band_center,
      terminal_g: terminal_growth_rate,
      discount,
      ceiling_multiple: valuation_multiple_ceiling,
      absurd_multiple: buffettMungerStrategy.valuation.fv_absurd_multiple,
      horizon: valHorizon,
    }).fair_value
    if (fvAtCenter !== undefined && Number.isFinite(fvAtCenter) && fvAtCenter > 0 && fvAtCenter <= MAX_PLAUSIBLE_FAIR_VALUE_PER_SHARE) {
      fair_value_per_share = Math.round(fvAtCenter * 100) / 100
    }
    // buy-below: the price at which market-implied growth rises to the buy-threshold (band_low − required_gap).
    const gThreshold = band.band_low - gap.required_gap
    // The reverse-DCF search brackets near-term growth in [G_LOW, G_HIGH] = [-0.5, 0.5]; a threshold below
    // that floor is not expressible by the round-trip, so skip (fail-closed → buy-band-unconfirmed clamp).
    if (Number.isFinite(gThreshold) && gThreshold > -0.5) {
      const fvAtThreshold = twoStageValuation({
        oe_ps: normalized_owner_earnings_per_share,
        g: gThreshold,
        terminal_g: terminal_growth_rate,
        discount,
        ceiling_multiple: valuation_multiple_ceiling,
        absurd_multiple: buffettMungerStrategy.valuation.fv_absurd_multiple,
        horizon: valHorizon,
      }).fair_value
      if (fvAtThreshold !== undefined && Number.isFinite(fvAtThreshold) && fvAtThreshold > 0 && fvAtThreshold <= MAX_PLAUSIBLE_FAIR_VALUE_PER_SHARE) {
        buy_price_per_share = Math.round(fvAtThreshold * 100) / 100
      }
    }
  }

  let verdict_state:
    | {
        state: 'BUY-WINDOW' | 'WATCH-FAIR' | 'WATCH'
        market_implied_growth?: number
        band_low?: number
        band_high?: number
        band_center?: number
        band_grounding_status?: 'grounded' | 'unsupported_high' | 'not_computable'
        band_basis_citations?: string[]
        required_gap?: number
        gap_to_band?: number
        implied_multiple?: number
        implied_above_band?: boolean
        note?: string
      }
    | undefined
  const sectorShariahFail = shariahJudgment?.sector_status === 'non_compliant'
    || shariah_financial?.verdict === 'FAIL'
  if (
    moat_passes_gate
    && !sectorShariahFail
    && market_implied_growth !== undefined
    && band.grounding_status !== 'not_computable'
    // A point fair value (positive OE/share, FV not discarded) underpins the reverse-DCF solve, so its
    // presence guarantees the implied growth inverts the SAME forward DCF.
    && fair_value_per_share !== undefined
    // The threshold-derived buy-below must also be expressible; if it failed closed (e.g. the buy-threshold
    // growth fell below the reverse-DCF bracket floor), leave verdict_state undefined → buy-band-unconfirmed.
    && buy_price_per_share !== undefined
  ) {
    const implied = market_implied_growth
    const lo = band.band_low
    const gapv = gap.required_gap
    const buyThreshold = lo - gapv
    // gap_to_band > 0 = how far BELOW the buy threshold the market sits (cheaper); < 0 = above it.
    const gap_to_band = buyThreshold - implied
    const common = {
      market_implied_growth: implied,
      band_low: band.band_low,
      band_high: band.band_high,
      band_center: band.band_center,
      band_grounding_status: band.grounding_status,
      band_basis_citations: band.basis_citations,
      required_gap: gapv,
      gap_to_band,
      ...(implied_multiple !== undefined ? { implied_multiple } : {}),
    }
    if (implied <= buyThreshold) {
      // CHEAP: market-implied growth is a full required-gap below the honest band's low edge.
      verdict_state = { state: 'BUY-WINDOW', ...common }
    } else if (implied <= lo) {
      // Within the honest band but no safety gap — human-discretion zone; never a harness buy signal.
      verdict_state = {
        state: 'WATCH-FAIR',
        ...common,
        note: 'Wonderful at fair — human-discretion zone. No harness buy signal.',
      }
    } else {
      // Fairly-to-richly priced. Flag when the market prices ABOVE what the business sustains.
      verdict_state = {
        state: 'WATCH',
        ...common,
        ...(implied >= band.band_high ? { implied_above_band: true } : {}),
      }
    }
  }

  // HIGH safety — clamp a model BUY when no buy band is computable. The deterministic verdict_state
  // (BUY-WINDOW / WATCH-FAIR / WATCH) is ONLY computed when buy_price, fair_value and current_price are
  // ALL present. When the moat gate passes but verdict_state is undefined (OE<=0, invalid shares,
  // implausible FV discarded, or the live price fetch failed), the deterministic buy window NEVER
  // confirmed the price sits in the buy band — so a model-proposed BUY must NOT be recorded. Force a
  // safe non-BUY verdict (RESEARCH_MORE — the existing "can't confirm" state) and surface the reason.
  const buyBandUnconfirmed =
    moat_passes_gate
    && verdict_state === undefined
    && dec.analysis.investment_verdict === 'BUY'
  const buyClampReason = buyBandUnconfirmed
    ? 'BUY not recordable: no computable buy band (missing/implausible valuation or price — owner '
      + 'earnings, shares, fair value, or the live price was unavailable) — defaulting to RESEARCH_MORE.'
    : undefined

  // Apply moat gate: if moat is below wide, override verdict to PASS regardless of model output.
  // WATCH-FAIR never escalates the verdict to BUY — when the model said BUY but the price sits above
  // the buy window (WATCH-FAIR), the harness records WATCH so it cannot emit a buy signal.
  const gatedVerdict = !moat_passes_gate
    ? ('PASS' as const)
    : buyBandUnconfirmed
      ? ('RESEARCH_MORE' as const)
      : verdict_state?.state === 'WATCH-FAIR'
        ? ('WATCH' as const)
        : dec.analysis.investment_verdict
  const gatedReason = !moat_passes_gate
    ? `Moat below the wide-moat gate (${moatClass}) — pass.`
    : buyBandUnconfirmed
      ? `${buyClampReason} ${dec.analysis.decision_reason}`
      : verdict_state?.state === 'WATCH-FAIR'
        ? `Wonderful at fair — human-discretion zone. No harness buy signal. ${dec.analysis.decision_reason}`
        : dec.analysis.decision_reason

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
  const exceptionalityJustifications = [
    ...(moatJudgment?.moat_rubric?.adjustment_evidence ?? []),
    ...(moatJudgment?.runway_rubric?.adjustment_evidence ?? []),
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
      investment_verdict: gatedVerdict,
      strategy_compliance: dec.analysis.strategy_compliance,
      shariah_status: undefined, // will be set below
      valuation_status: dec.analysis.valuation_status,
      next_required_action: moat_passes_gate ? dec.analysis.next_required_action : gatedReason,
      quick_screen: undefined, // populated below
      valuation: {
        moat_class: moatClass,
        moat_passes_gate,
        runway,
        ...(runway_exceptional ? { runway_exceptional } : {}),
        discount_rate: discount,
        // Discount provenance (Phase 1.4): live Treasury (or the config default) + the uniform equity premium.
        discount_inputs: {
          ten_year_treasury: ten_year_treasury ?? buffettMungerStrategy.valuation.ten_year_treasury_default,
          ten_year_treasury_basis: ten_year_treasury !== undefined ? 'live' : 'config_default',
          equity_premium: buffettMungerStrategy.valuation.equity_premium,
        },
        growth_assumptions: dec.analysis.growth_assumptions,
        growth_rate: effective_growth_rate,
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
        ...(normalized_owner_earnings_per_share !== undefined ? { normalized_owner_earnings_per_share } : {}),
        ...(valuationCaveats.length > 0 ? { valuation_caveats: valuationCaveats } : {}),
        // Visible degraded flags: each OPTIONAL structured field the model omitted (rubric, Shariah
        // overlay, growth inputs) is recorded here so the silent skips the live dogfood exposed are SEEN.
        ...(degradedFlags.length > 0 ? { degraded_flags: degradedFlags } : {}),
        ...(fair_value_per_share !== undefined ? { fair_value_per_share } : {}),
        ...(implied_multiple !== undefined ? { implied_multiple } : {}),
        ...(terminal_value_pct_of_iv !== undefined ? { terminal_value_pct_of_iv } : {}),
        ...(cap_exceeded ? { cap_exceeded: true } : {}),
        ...(margin_of_safety !== undefined ? { margin_of_safety } : {}),
        // Phase 1.7 provenance: the end-stage MoS actually applied + why it widened beyond the moat floor.
        ...(margin_of_safety !== undefined ? { margin_of_safety_applied: margin_of_safety } : {}),
        ...(margin_of_safety_widening_reasons.length > 0 ? { margin_of_safety_widening_reasons } : {}),
        ...(buy_price_per_share !== undefined ? { buy_price_per_share } : {}),
        // Phase 2: the fair-value RANGE (low–high, base) — the dossier leads with this instead of the
        // point FV. Omitted when not computable (point FV still stands as the base).
        ...(fair_value_range !== undefined ? { fair_value_range } : {}),
        ...(fair_value_range_basis !== undefined ? { fair_value_range_basis } : {}),
        // Phase 2: the near-term growth TODAY'S PRICE implies (reverse-DCF). Omitted when no price.
        ...(market_implied_growth !== undefined ? { market_implied_growth } : {}),
        // Phase 2: the base FV is cap-LIMITED (demonstrated growth above the named cap), not estimate-limited.
        ...(valuation_cap_binding ? { valuation_cap_binding: true } : {}),
        // Price → verdict band (BUY-WINDOW | WATCH-FAIR | WATCH) when a current price + buy/fair exist.
        ...(verdict_state !== undefined ? { verdict_state } : {}),
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
      },
      // Harness-computed AAOIFI Shariah financial ratios (re-verifying the model). Absent when not
      // computable (EDGAR/market-cap/impermissible-income missing) — caller falls back to lane verdict.
      ...(shariah_financial !== undefined ? { shariah_financial } : {}),
      ...(shariahJudgment !== undefined ? { shariah_sector_status: shariahJudgment.sector_status } : {}),
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
  const analysisShariahStatusForPhase: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN' =
    sectorHardStop ? 'NON_COMPLIANT'
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
      sources: captured.map((c) => ({
        source_id: c.source_id,
        kind: 'url' as const,
        title: c.title,
        url: c.url,
        excerpt: c.excerpt,
        availability: c.availability,
        ...(c.content_hash === undefined ? {} : { content_hash: c.content_hash }),
        metadata: {
          research_case_id: command.research_case_id,
          ...(c.http_status === undefined ? {} : { http_status: c.http_status }),
        },
      })),
    })
  }

  return {
    deep_dive: { queued, started, findings, synthesis, completed },
    analysis,
    decision,
  }
}
