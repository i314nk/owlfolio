import { z, type ZodType } from 'zod'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { Provider } from '@owlfolio/providers'
import { groundProposedSources, type CapturedSource, type GroundingDeps, type ProposedSource } from './sourceGrounding'
import { computeIncrementalRoic, fetchCompanyFundamentals, type Fundamentals, type SecEdgarDeps } from './secEdgar'
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
import { buffettMungerStrategy, creditedGrowth, discountRate, marginOfSafetyForMoat, moatPassesGate, stage1HorizonForMoat, terminalGrowthForMoat, twoStageFairValuePerShare } from '@owlfolio/strategies/buffettMunger'
import { computeShariahFinancialRatios } from '@owlfolio/strategies/shariahFinancialRatios'
import { fetchAverageMarketCap, resolveCurrentPrice, type AverageMarketCapResult, type MarketDataDeps, type PriceQuote } from './marketData'

export const ProposedSourceSchema = z.object({
  source_id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  excerpt: z.string().min(1),
  citation_locator: z.string().optional(),
})
export const ProposedSourcesSchema = z.array(ProposedSourceSchema).min(1)

export type GroundFn = (
  sources: z.infer<typeof ProposedSourcesSchema>,
  deps?: GroundingDeps,
) => Promise<{
  captured: CapturedSource[]
  verified_ids: string[]
}>

export type GroundedAgentRequest = {
  run_id: string
  model_id: string
  prompt: string
  timeout_ms: number
  schema_name?: string
}

export type GroundedAgentResult<T> = {
  analysis: T & { proposed_sources: z.infer<typeof ProposedSourcesSchema> }
  captured: CapturedSource[]
  verified_ids: string[]
}

export async function runGroundedAgent<T extends { proposed_sources: z.infer<typeof ProposedSourcesSchema> }>(
  provider: Provider,
  request: GroundedAgentRequest,
  schema: ZodType<T>,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<GroundedAgentResult<T>> {
  const ground = deps.ground ?? groundProposedSources
  const analysis = await provider.structured(
    {
      run_id: request.run_id,
      model_id: request.model_id,
      task_kind: 'structured-output',
      prompt: request.prompt,
      timeout_ms: request.timeout_ms,
      budget: { max_tool_calls: 0, max_tokens: 8_000 },
      tool_allowlist: [],
      response_format: { kind: 'json-schema', schema_name: request.schema_name ?? 'GroundedAgent' },
    },
    schema,
  )
  // Cast: Zod infers `citation_locator?: string | undefined` but ProposedSource uses
  // exactOptionalPropertyTypes (`citation_locator?: string`). The runtime shapes are
  // identical — absent vs. explicitly undefined is only a type distinction.
  const { captured, verified_ids } = await ground(
    analysis.proposed_sources as ProposedSource[],
    deps.grounding,
  )
  return { analysis, captured, verified_ids }
}

/**
 * Resilient wrapper around {@link runGroundedAgent} for the bookend calls (quick-screen and
 * synthesis/decision) that are NOT covered by the per-lane try/catch. A single 180s provider
 * timeout on either bookend would otherwise abort the entire run; this adds a single retry on a
 * transient error so a flaky timeout recovers. On the final (post-retry) failure it rethrows so the
 * caller can record a clean failed-run outcome.
 */
export async function runGroundedAgentWithRetry<T extends { proposed_sources: z.infer<typeof ProposedSourcesSchema> }>(
  provider: Provider,
  request: GroundedAgentRequest,
  schema: ZodType<T>,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
  opts: { retries?: number } = {},
): Promise<GroundedAgentResult<T>> {
  const retries = opts.retries ?? 1
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await runGroundedAgent(provider, request, schema, deps)
    } catch (error) {
      lastError = error
      // One more attempt on a transient failure (e.g. a 180s timeout). No backoff needed for the
      // alpha — the provider call itself is the slow part.
    }
  }
  throw lastError
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
// Per-stage Zod schemas (each includes proposed_sources for grounding)
// ---------------------------------------------------------------------------

const QuickScreenAgentSchema = z.object({
  summary: z.string().min(1),
  business_quality: z.string().min(1),
  moat: z.string().min(1),
  management_capital_allocation: z.string().min(1),
  financial_quality: z.string().min(1),
  valuation_sanity: z.string().min(1),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'PENDING']),
  red_flags: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  screening_result: z.enum(['pass', 'reject', 'needs_data', 'deep_dive_candidate']),
  proposed_sources: ProposedSourcesSchema,
})

const LaneAgentSchema = z.object({
  finding_summary: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  proposed_sources: ProposedSourcesSchema,
})

const OwnerEarningsBridgeSchema = z.object({
  // Company TOTALS in $MILLIONS, judgment-grounded by the valuation specialist from the latest 10-K.
  // These are aggregate amounts, NOT per-share — the harness divides total owner earnings by
  // shares_outstanding to get owner earnings per share.
  net_income: z.number(),
  depreciation_amortization: z.number(),
  maintenance_capex: z.number(),
  maintenance_capex_proxy_tier: z.enum(['20', '50', '80']),
  stock_based_comp: z.number(),
  // SIGNED: positive = WC is a use of cash (reduces OE); negative = structural WC release (adds to OE)
  normalized_working_capital_change: z.number(),
  // Diluted weighted-average shares outstanding, in MILLIONS, from the latest 10-K — same scale as
  // the $-millions amounts above. Required to convert total owner earnings to a per-share figure.
  shares_outstanding: z.number(),
})

// SHARIAH lane JUDGMENT overlay (the LLM identifies; the harness recomputes the financial ratios).
// sector_status confirms the Stage-0 finding with segment data; impermissible_income is the dollar
// amount ($MILLIONS) of non-permissible income (interest income, prohibited-segment revenue). The
// harness divides this by EDGAR revenue — it does NOT trust the model's own ratio arithmetic.
const ShariahJudgmentSchema = z.object({
  sector_status: z.enum(['compliant', 'conditional', 'non_compliant']),
  // Impermissible income in $MILLIONS (same scale as EDGAR revenue). 0 when fully permissible.
  impermissible_income: z.number().min(0),
})

const DecisionAgentSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  decision_reason: z.string().min(1),
  thesis_summary: z.string().min(1),
  evidence_summary: z.string().min(1),
  valuation_rationale: z.string().min(1),
  shariah_rationale: z.string().min(1),
  synthesis_summary: z.string().min(1),
  risks: z.array(z.string().min(1)).min(1),
  open_questions: z.array(z.string().min(1)).min(1),
  // Model-supplied valuation judgment fields (harness computes fair value and buy_price from these)
  moat_class: z.enum(['narrow', 'moderate', 'wide', 'monopoly']),
  // Reinvestment runway — a SEPARATE axis from moat (MOAT lane). Binding for growth credit.
  //   proven  — ≥5 yrs incremental capital deployed at high ROIC, visible headroom remaining
  //   limited — high ROIC but little incremental capital absorbed
  //   none    — mature/regulated, FCF mostly distributed
  runway: z.enum(['proven', 'limited', 'none']),
  // Optional: VALUATION/MOAT lane may flag an exceptional runway (with headroom evidence) to allow
  // the top of a growth band. Defaults to false when omitted.
  runway_exceptional: z.boolean().optional(),
  growth_assumptions: z.string().min(1),
  // Owner-earnings bridge — totals in $millions, judgment-grounded
  owner_earnings_bridge: OwnerEarningsBridgeSchema,
  // SHARIAH financial judgment overlay — sector status + impermissible income ($M). Optional so the
  // swarm runs unchanged when the model omits it (harness falls back to the quick-screen status).
  shariah: ShariahJudgmentSchema.optional(),
  // ROIC inputs. `roic` is reported context; `incremental_roic` (normalized INCREMENTAL ROIC, a
  // fraction, e.g. 0.20) drives credited growth eligibility + magnitude.
  roic: z.number(),
  incremental_roic: z.number(),
  reinvestment_rate: z.number(),
  proposed_sources: ProposedSourcesSchema,
})

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
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function swarmSeg(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
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
    // No injection: in offline test mode, do NOT hit SEC live (offline/deterministic tests).
    if (isOfflineTestMode()) return undefined
    return await fetchCompanyFundamentals(ticker)
  } catch {
    return undefined
  }
}

/**
 * Resolve a current price for a ticker, fail-closed and test-mode-gated (mirrors resolveFundamentals).
 * Returns undefined on any failure / unavailable quote so the AAOIFI debt/cash ratios degrade to the
 * lane's proposed Shariah verdict instead of emitting a bogus market cap.
 */
async function resolveCurrentPriceValue(ticker: string, deps: FundamentalsDeps): Promise<number | undefined> {
  try {
    const resolver = deps.resolvePrice
      ?? (isOfflineTestMode()
        ? undefined
        : ((t: string, d?: MarketDataDeps) => resolveCurrentPrice({ ticker: t }, d)))
    if (resolver === undefined) return undefined
    const quote = await resolver(ticker)
    return quote.available ? quote.price_per_share : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the trailing 36-month AVERAGE market cap ($MILLIONS) for a ticker, fail-closed and
 * test-mode-gated (mirrors resolveCurrentPriceValue). Returns undefined on any failure/unavailable
 * series so the Shariah ratios degrade to the CURRENT-price market cap. `diluted_shares` is in
 * MILLIONS so the returned market cap is in $MILLIONS (matching the AAOIFI ratio inputs).
 */
async function resolveAverageMarketCapValue(
  ticker: string,
  diluted_shares: number,
  deps: FundamentalsDeps,
): Promise<{ market_cap: number; months: number } | undefined> {
  try {
    const resolver = deps.resolveAverageMarketCap
      ?? (isOfflineTestMode()
        ? undefined
        : ((t: string, shares: number, d?: MarketDataDeps) => fetchAverageMarketCap({ ticker: t }, shares, undefined, d)))
    if (resolver === undefined) return undefined
    const result = await resolver(ticker, diluted_shares)
    return result.available ? { market_cap: result.market_cap, months: result.months } : undefined
  } catch {
    return undefined
  }
}

/**
 * Maintenance-capex fraction implied by the LLM's proxy tier. The model proposes the TIER (judgment);
 * the harness applies the fraction to EDGAR capex deterministically (per buffett-valuation-method-v2:
 * maintenance_capex = min(D&A, capex × fraction)).
 */
function maintenanceFractionForTier(tier: '20' | '50' | '80'): number {
  return Number(tier) / 100
}

function fmtMusd(v: number | undefined): string {
  return v === undefined ? 'n/a' : `$${Math.round(v).toLocaleString('en-US')}M`
}

function fmtShares(v: number | undefined): string {
  return v === undefined ? 'n/a' : `${v.toFixed(1)}M`
}

/**
 * Build a compact, grounded primary-filing context block for injection into a lane prompt. Includes
 * the OE-bridge raw inputs, revenue, debt, cash, interest expense, the multi-year series, and the
 * grounded EDGAR source_id the lane MUST cite.
 */
function buildPrimaryFilingBlock(f: Fundamentals, sourceId: string): string {
  const la = f.latest_annual
  const series = f.annual_series.slice(0, 11) // latest + up to 10 prior years
  const seriesLines = series.map((a) =>
    `  FY${a.fiscal_year}: NI ${fmtMusd(a.net_income_musd)}, rev ${fmtMusd(a.revenue_musd)}, `
    + `D&A ${fmtMusd(a.d_and_a_musd)}, capex ${fmtMusd(a.capex_musd)}, SBC ${fmtMusd(a.sbc_musd)}, `
    + `diluted shares ${fmtShares(a.diluted_shares_m)}`,
  ).join('\n')

  return (
    `\n\nPrimary filing data (SEC EDGAR, FY${la.fiscal_year}, source ${sourceId}) — ${f.entity_name} (CIK ${f.cik}). `
    + `These are RAW values from the latest 10-K, in $millions and share-millions. USE these primary numbers `
    + `as the authoritative basis for your finding (you may still normalize, e.g. estimate the maintenance-capex `
    + `fraction of total capex), and CITE source ${sourceId} (the EDGAR 10-K) in proposed_sources.\n`
    + `Latest annual (FY${la.fiscal_year}): net_income ${fmtMusd(la.net_income_musd)}, revenue ${fmtMusd(la.revenue_musd)}, `
    + `D&A ${fmtMusd(la.d_and_a_musd)}, total_capex ${fmtMusd(la.capex_musd)}, SBC ${fmtMusd(la.sbc_musd)}, `
    + `diluted_shares ${fmtShares(la.diluted_shares_m)}, shares_outstanding ${fmtShares(la.shares_outstanding_m)}, `
    + `total_debt ${fmtMusd(la.total_debt_musd)}, cash_and_securities ${fmtMusd(la.cash_and_securities_musd)}, `
    + `interest_expense ${fmtMusd(la.interest_expense_musd)}.\n`
    + `Multi-year annual series (newest first, ${series.length} of ${f.annual_series.length} yrs):\n${seriesLines}`
  )
}

// Lanes that receive the primary-filing data injection (they consume hard financials).
const PRIMARY_FILING_LANES: ReadonlySet<string> = new Set(['financial_quality', 'valuation', 'shariah'])

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
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number } & FundamentalsDeps = {},
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
  try {
    qs = await runGroundedAgentWithRetry(provider, {
    run_id: `run_${command.research_case_id}_quick_screen`,
    model_id: command.model_id,
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
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number; accumulated?: Map<string, CapturedSource> } & FundamentalsDeps = {},
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
    const agent = await runGroundedAgent(provider, {
      run_id: `run_${command.research_case_id}_${swarmSeg(lane)}`,
      model_id: command.model_id,
      prompt: `You are the Buffett-Munger ${lane} specialist agent for ${command.ticker}. `
        + `Produce a source-backed finding for the ${lane} lane only. Gather your own sources; return them in proposed_sources with real URLs.`
        + (injectFiling ? primaryFilingBlock : ''),
      timeout_ms: AGENT_TIMEOUT_MS,
      schema_name: 'BuffettMungerLaneFinding',
    }, LaneAgentSchema, deps)
    remember(agent.captured)
    // The grounded EDGAR 10-K is a guaranteed verified primary citation for the injected lanes —
    // include it in the lane's verified_ids so the lane records a finding even if the model proposed
    // no other verifiable source (this is what fixes the lane-drop when IR/news is blocked).
    const verified_ids = injectFiling && primaryFilingSourceId !== undefined
      ? [...new Set([primaryFilingSourceId, ...agent.verified_ids])]
      : agent.verified_ids
    return {
      lane,
      finding_summary: agent.analysis.finding_summary,
      confidence: agent.analysis.confidence,
      caveats: agent.analysis.caveats,
      verified_ids,
    }
  }, { concurrency: deps.laneConcurrency ?? 4 })

  // ---- Record specialist findings ----
  // C1: only record findings for lanes with at least one verified source id;
  // lanes with zero verified ids (incomplete or all-sources-unverified) are
  // skipped and noted so incompleteness surfaces in synthesis caveats.
  const findings: Awaited<ReturnType<typeof recordSpecialistFinding>>[] = []
  const laneNotes: string[] = []
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

  // ---- Synthesis + decision agent ----
  // Resilient bookend: a single 180s timeout here would otherwise discard all completed lane
  // findings. We retry once on a transient failure; on final failure we raise a structured
  // ResearchSwarmStageError noting the lanes already completed (so the run can be resumed/retried)
  // — the lane findings are already persisted to the ledger above and are NOT lost.
  let dec: GroundedAgentResult<z.infer<typeof DecisionAgentSchema>>
  try {
    dec = await runGroundedAgentWithRetry(provider, {
    run_id: `run_${command.research_case_id}_synthesis`,
    model_id: command.model_id,
    prompt: `You are the Buffett-Munger synthesis+decision agent for ${command.ticker}. `
      + `Using the lane findings, produce a verdict, thesis, evidence, valuation rationale, Shariah rationale, risks, open questions, and a synthesis summary. `
      + `For the owner_earnings_bridge, provide company TOTALS in $millions from the latest 10-K (net_income, depreciation_amortization, maintenance_capex, stock_based_comp, normalized_working_capital_change) AND shares_outstanding (diluted weighted-average shares outstanding, in MILLIONS) so the harness can compute owner earnings per share. `
      + `Also classify the reinvestment runway as 'proven' | 'limited' | 'none' (a SEPARATE axis from moat width — proven means ≥5 yrs of incremental capital deployed at high ROIC with visible remaining headroom), set runway_exceptional only with explicit headroom evidence, and report incremental_roic (normalized INCREMENTAL ROIC as a fraction, e.g. 0.20) alongside reinvestment_rate. The harness credits growth only when incremental_roic exceeds 10%; historical revenue/EPS growth is never an input. `
      + `For shariah, provide the JUDGMENT only: sector_status ('compliant' | 'conditional' | 'non_compliant') confirmed with segment revenue, and impermissible_income — the dollar amount in $MILLIONS of non-permissible income (interest income on cash, prohibited-segment revenue), 0 if fully permissible. The harness recomputes the AAOIFI debt/cash/impermissible ratios + verdict + purification % from the primary filings + market cap; do NOT compute the ratios yourself. `
      + `Cite sources in proposed_sources with real URLs.`,
    timeout_ms: AGENT_TIMEOUT_MS,
    schema_name: 'BuffettMungerSynthesisDecision',
    }, DecisionAgentSchema, deps)
  } catch (error) {
    // Synthesis retry exhausted: lane findings are already persisted (lanes_completed: true) so the
    // run is resumable. Fail cleanly instead of throwing a raw provider/timeout error.
    throw new ResearchSwarmStageError('synthesis', error, { lanes_completed: true })
  }
  remember(dec.captured)

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
  // Credited growth g (Step 3): raw_g = reinvestment_rate × incremental_roic, clamped by runway/moat
  //   band ceiling and the 5% absolute max; g=0 unless incremental_roic > 10%.
  // Terminal growth g_t (Step 4): monopoly 2% / wide 1%. Flat 10% discount, always.
  // Two-stage FV (Step 4):
  //   FV_ps = Σ_{t=1..10} OE_ps(1+g)^t/(1+r)^t + [OE_ps(1+g)^10(1+g_t)/(r−g_t)]/(1+r)^10
  //   FV_ps = min(FV_ps, 18 × OE_ps)   (sanity cap)
  // Buy price (Step 5): round(FV_ps × (1 − MoS), 2)  MoS = monopoly 20% / wide 30%.
  const moatClass = dec.analysis.moat_class
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
  const normalized_working_capital_change = modelBridge.normalized_working_capital_change

  if (edgarBridgeUsable && edgarAnnual !== undefined) {
    const maintenance_fraction = maintenanceFractionForTier(modelBridge.maintenance_capex_proxy_tier)
    const edgar_d_and_a = edgarAnnual.d_and_a_musd as number
    const edgar_capex = edgarAnnual.capex_musd as number
    // Model's net-income normalization delta carried onto EDGAR's reported NI (judgment overlay).
    const normalization_delta = modelBridge.net_income - edgarAnnual.net_income_musd!
    net_income = edgarAnnual.net_income_musd! + normalization_delta
    d_and_a = edgar_d_and_a
    maintenance_capex = Math.min(edgar_d_and_a, edgar_capex * maintenance_fraction)
    stock_based_comp = edgarAnnual.sbc_musd as number  // SBC always subtracted, in full
    shares_outstanding = edgarAnnual.diluted_shares_m as number  // CURRENT diluted shares
    bridge_fiscal_year = edgarAnnual.fiscal_year
    bridge_source_id = primaryFilingSourceId
  } else {
    net_income = modelBridge.net_income
    d_and_a = modelBridge.depreciation_amortization
    maintenance_capex = modelBridge.maintenance_capex
    stock_based_comp = modelBridge.stock_based_comp
    shares_outstanding = modelBridge.shares_outstanding
  }

  // The recorded bridge reflects what the harness actually used (EDGAR-anchored when available),
  // preserving the model's tier + working-capital judgment.
  const bridge = {
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

  const discount = discountRate(buffettMungerStrategy)
  const roic = dec.analysis.roic
  // ---- Incremental ROIC: harness-computed from the EDGAR multi-year series when reliable ----
  // (buffett-valuation-method-v2 Step 3). NOPAT proxy = operating income × (1 − eff. tax) [or NI +
  // after-tax interest]; invested capital proxy = equity + total debt − cash; incremental ROIC ≈
  // Δ(NOPAT)/Δ(invested capital) over ~5 yrs. We use the harness value for growth eligibility/credit
  // and FALL BACK to the lane's proposed incremental_roic when EDGAR data is insufficient or the
  // proxy is unreliable (negative/odd) — keeping it honest with a recorded note.
  const laneIncrementalRoic = dec.analysis.incremental_roic
  let incremental_roic = laneIncrementalRoic
  let incremental_roic_basis: 'sec_edgar' | 'model_proposed' = 'model_proposed'
  if (fundamentals?.annual_series !== undefined && fundamentals.annual_series.length >= 2) {
    const incRoic = computeIncrementalRoic(fundamentals.annual_series)
    if (incRoic.computable) {
      incremental_roic = incRoic.incremental_roic
      incremental_roic_basis = 'sec_edgar'
    }
  }
  const reinvestment_rate = dec.analysis.reinvestment_rate
  const runway = dec.analysis.runway
  const runway_exceptional = dec.analysis.runway_exceptional ?? false
  const valuation_multiple_ceiling = buffettMungerStrategy.valuation.valuation_multiple_ceiling

  const valuationCaveats: string[] = []
  let buy_price_per_share: number | undefined
  let fair_value_per_share: number | undefined
  let implied_multiple: number | undefined
  let margin_of_safety: number | undefined
  let terminal_growth_rate: number | undefined

  // Credited growth g — deterministic banded clamp (incremental-ROIC gated; runway sets value).
  const effective_growth_rate = creditedGrowth(buffettMungerStrategy, {
    reinvestment_rate,
    incremental_roic,
    runway,
    moat_class: moatClass,
    runway_exceptional,
  })

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
    // Moat-dependent stage-1 horizon (recalibrated, spec §1): monopoly 15 yrs, wide 10.
    const horizon = stage1HorizonForMoat(buffettMungerStrategy, moatClass)
    const computedFairValue = twoStageFairValuePerShare({
      oe_ps: normalized_owner_earnings_per_share,
      g: effective_growth_rate,
      terminal_g,
      discount,
      ceiling_multiple: valuation_multiple_ceiling,
      horizon,
    })
    // Sanity guard: degrade gracefully if the per-share fair value is non-finite, <= 0, or implausibly large.
    if (!Number.isFinite(computedFairValue) || computedFairValue <= 0 || computedFairValue > MAX_PLAUSIBLE_FAIR_VALUE_PER_SHARE) {
      valuationCaveats.push(
        `Valuation discarded: computed fair value per share (${Number.isFinite(computedFairValue) ? computedFairValue.toFixed(2) : 'non-finite'}) is implausible — owner-earnings inputs likely mis-scaled. No buy price emitted.`,
      )
    } else {
      fair_value_per_share = computedFairValue
      terminal_growth_rate = terminal_g
      implied_multiple = computedFairValue / normalized_owner_earnings_per_share
      margin_of_safety = marginOfSafetyForMoat(buffettMungerStrategy, moatClass)
      buy_price_per_share = Math.round(fair_value_per_share * (1 - margin_of_safety) * 100) / 100
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

  // The SHARIAH lane (LLM) identifies the sector status + impermissible income ($M); the harness
  // RECOMPUTES the three AAOIFI financial ratios + verdict + purification % from EDGAR debt/cash/
  // revenue + market cap — re-verifying the model rather than trusting its ratio arithmetic. When
  // EDGAR/market-cap/impermissible-income are missing it is not computable and we fall back to the
  // lane's proposed (quick-screen) Shariah verdict. The SECTOR FAIL hard stop is independent of this
  // financial-ratio layer (handled by the quick-screen short-circuit + sector_status below).
  const shariahJudgment = dec.analysis.shariah
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
  if (
    fundamentals?.latest_annual !== undefined
    && market_cap !== undefined
    && shariahJudgment !== undefined
  ) {
    const la = fundamentals.latest_annual
    const ratios = computeShariahFinancialRatios({
      interest_bearing_debt: la.total_debt_musd ?? NaN,
      cash_and_securities: la.cash_and_securities_musd ?? NaN,
      total_revenue: la.revenue_musd ?? NaN,
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
    }
  }

  // ---- Price → verdict band (valuation-recalibration-spec §2: WATCH-FAIR) ----
  // For gate-clean names (moat passes, Shariah not FAIL) with a computed buy/fair price and a current
  // price, classify the price band:
  //   price <= buy_price              → BUY-WINDOW
  //   buy_price < price <= fair_value → WATCH-FAIR  (NEW — human-discretion zone; never a buy signal)
  //   price > fair_value              → WATCH
  // WATCH-FAIR carries the discount-to-FV %, the implied multiple, and the editorial line. It NEVER
  // auto-escalates to BUY. The moat gate / Shariah FAIL still force PASS/STOP above this band.
  let verdict_state:
    | { state: 'BUY-WINDOW' | 'WATCH-FAIR' | 'WATCH'; discount_to_fv_pct?: number; implied_multiple?: number; note?: string }
    | undefined
  const sectorShariahFail = shariahJudgment?.sector_status === 'non_compliant'
    || shariah_financial?.verdict === 'FAIL'
  if (
    moat_passes_gate
    && !sectorShariahFail
    && current_price !== undefined
    && buy_price_per_share !== undefined
    && fair_value_per_share !== undefined
  ) {
    if (current_price <= buy_price_per_share) {
      verdict_state = { state: 'BUY-WINDOW', ...(implied_multiple !== undefined ? { implied_multiple } : {}) }
    } else if (current_price <= fair_value_per_share) {
      const discount_to_fv_pct = ((fair_value_per_share - current_price) / fair_value_per_share) * 100
      verdict_state = {
        state: 'WATCH-FAIR',
        discount_to_fv_pct,
        ...(implied_multiple !== undefined ? { implied_multiple } : {}),
        note: 'Wonderful at fair — human-discretion zone. No harness buy signal.',
      }
    } else {
      verdict_state = { state: 'WATCH', ...(implied_multiple !== undefined ? { implied_multiple } : {}) }
    }
  }

  // Apply moat gate: if moat is below wide, override verdict to PASS regardless of model output.
  // WATCH-FAIR never escalates the verdict to BUY — when the model said BUY but the price sits above
  // the buy window (WATCH-FAIR), the harness records WATCH so it cannot emit a buy signal.
  const gatedVerdict = !moat_passes_gate
    ? ('PASS' as const)
    : verdict_state?.state === 'WATCH-FAIR'
      ? ('WATCH' as const)
      : dec.analysis.investment_verdict
  const gatedReason = !moat_passes_gate
    ? `Moat below the wide-moat gate (${moatClass}) — pass.`
    : verdict_state?.state === 'WATCH-FAIR'
      ? `Wonderful at fair — human-discretion zone. No harness buy signal. ${dec.analysis.decision_reason}`
      : dec.analysis.decision_reason

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
        growth_assumptions: dec.analysis.growth_assumptions,
        growth_rate: effective_growth_rate,
        ...(terminal_growth_rate !== undefined ? { terminal_growth_rate } : {}),
        roic,
        incremental_roic,
        incremental_roic_basis,
        reinvestment_rate,
        owner_earnings_bridge: bridge,
        ...(normalized_owner_earnings_per_share !== undefined ? { normalized_owner_earnings_per_share } : {}),
        ...(valuationCaveats.length > 0 ? { valuation_caveats: valuationCaveats } : {}),
        ...(fair_value_per_share !== undefined ? { fair_value_per_share } : {}),
        ...(implied_multiple !== undefined ? { implied_multiple } : {}),
        ...(margin_of_safety !== undefined ? { margin_of_safety } : {}),
        ...(buy_price_per_share !== undefined ? { buy_price_per_share } : {}),
        // Price → verdict band (BUY-WINDOW | WATCH-FAIR | WATCH) when a current price + buy/fair exist.
        ...(verdict_state !== undefined ? { verdict_state } : {}),
        value_basis: 'two_stage_dcf',
        // OE-bridge provenance: 'sec_edgar' (anchored to the 10-K) vs 'model_proposed'.
        bridge_basis,
        ...(bridge_fiscal_year !== undefined ? { bridge_fiscal_year } : {}),
        ...(bridge_source_id !== undefined ? { bridge_source_id } : {}),
      },
      // Harness-computed AAOIFI Shariah financial ratios (re-verifying the model). Absent when not
      // computable (EDGAR/market-cap/impermissible-income missing) — caller falls back to lane verdict.
      ...(shariah_financial !== undefined ? { shariah_financial } : {}),
      ...(shariahJudgment !== undefined ? { shariah_sector_status: shariahJudgment.sector_status } : {}),
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

  const decision = await draftDecision(store, {
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    decision: gatedVerdict,
    reason: gatedReason,
    thesis_summary: dec.analysis.thesis_summary,
    evidence_summary: dec.analysis.evidence_summary,
    valuation_rationale: (moat_passes_gate ? dec.analysis.valuation_rationale : `Moat gate rejected: ${moatClass} is below the minimum investable moat (wide). No buy price computed.`)
      + (valuationCaveats.length > 0 ? ` ${valuationCaveats.join(' ')}` : ''),
    shariah_rationale: dec.analysis.shariah_rationale,
    risks: dec.analysis.risks,
    open_questions: dec.analysis.open_questions,
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
