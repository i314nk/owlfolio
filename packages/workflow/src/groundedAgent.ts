import { z, type ZodType } from 'zod'
import type { Provider, ProviderToolExecutor } from '@owlfolio/providers'
import { groundProposedSources, groundProposedSourcesForLane, type CapturedSource, type GroundingDeps, type ProposedSource, type SourcePolicyRejection } from './sourceGrounding'
import { fetchCompanyFundamentals, type Fundamentals, type SecEdgarDeps } from './secEdgar'
import { readGroundedSource, type ReadSourceOptions, type ReadSourceResult } from './sourceRead'

// ---------------------------------------------------------------------------
// Grounded-agent primitives (extracted from researchSwarm so they can be imported by BOTH the swarm
// orchestrator AND the red-team pass without a circular module-evaluation dependency). researchSwarm
// re-exports these for existing importers.
// ---------------------------------------------------------------------------

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
  /** Mechanism 6: sources rejected by the per-lane source whitelist (only set when `lane` is passed). */
  policy_rejections: SourcePolicyRejection[]
}

export async function runGroundedAgent<T extends { proposed_sources: z.infer<typeof ProposedSourcesSchema> }>(
  provider: Provider,
  request: GroundedAgentRequest,
  schema: ZodType<T>,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
  /**
   * Mechanism 6: when a `lane` id is supplied, the proposed sources are first gated by that lane's
   * source-discipline whitelist (classification lanes admit only primary docs; risks admits all),
   * then grounded through the SAME fetcher. Rejections are recorded (never silently dropped). When
   * omitted, grounding is unchanged (the bookend quick-screen/synthesis calls span all lanes).
   */
  opts: { lane?: string } = {},
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
  const proposed = analysis.proposed_sources as ProposedSource[]
  if (opts.lane !== undefined) {
    const { captured, verified_ids, policy_rejections } = await groundProposedSourcesForLane(
      opts.lane,
      proposed,
      { ...deps.grounding, ground },
    )
    return { analysis, captured, verified_ids, policy_rejections }
  }
  const { captured, verified_ids } = await ground(proposed, deps.grounding)
  return { analysis, captured, verified_ids, policy_rejections: [] }
}

/**
 * Resilient wrapper around {@link runGroundedAgent} for the bookend calls (quick-screen and
 * synthesis/decision) that are NOT covered by the per-lane try/catch. A single per-call provider
 * timeout (the generous 300s backstop) on either bookend would otherwise abort the entire run; this
 * adds a single retry on a transient error so a flaky timeout recovers. On the final (post-retry)
 * failure it rethrows so the caller can record a clean failed-run outcome.
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
      // One more attempt on a transient failure (e.g. a per-call timeout). No backoff needed for the
      // alpha — the provider call itself is the slow part.
    }
  }
  throw lastError
}

// ---------------------------------------------------------------------------
// Grounded multi-step tool loop (Phase 1 gather → Phase 2 synthesis)
//
// The PROVIDER (packages/providers) owns only the tool-calling TRANSPORT + loop mechanics. The grounding
// (SSRF + sha256 + source-ledger capture via fetchAndCaptureSource/groundProposedSources, and EDGAR
// discovery via secEdgar) MUST stay in this workflow layer — packages/providers cannot import it. So the
// harness builds the grounded tool EXECUTORS here and injects them into provider.runToolLoop. The grounding
// invariant is structural: the model can only read (and later cite) bytes this executor fetched + hashed.
// ---------------------------------------------------------------------------

/** The grounded tool names the harness exposes to the model (the provider tool_allowlist for the loop). */
export const GROUNDED_TOOL_NAMES = ['fetch_source', 'search_filings', 'read_source'] as const

/**
 * OpenAI-function-tool `parameters` JSON Schemas for the grounded tools. Passed to the provider so the
 * model knows each tool's arguments. fetch_source is the ONLY citable path (it grounds + hashes a url);
 * search_filings is DISCOVERY only (it returns candidate EDGAR urls the model must then fetch_source).
 */
export const GROUNDED_TOOL_PARAMETERS: Record<string, unknown> = {
  fetch_source: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Absolute https URL of a PRIMARY source to fetch (e.g. an SEC filing). The harness fetches, SSRF-guards, content-hashes, and ledgers it; only then may you cite the returned source_id.' },
    },
  },
  search_filings: {
    type: 'object',
    additionalProperties: false,
    required: ['ticker'],
    properties: {
      ticker: { type: 'string', description: 'US ticker to look up SEC EDGAR annual filings (10-K/20-F/40-F) for.' },
      query: { type: 'string', description: 'Optional free-text note about what you are looking for (advisory only).' },
    },
  },
  read_source: {
    type: 'object',
    additionalProperties: false,
    required: ['source_id'],
    properties: {
      source_id: { type: 'string', description: 'A VERIFIED source_id (from a prior fetch_source result or the pre-verified primary-sources block) whose already-grounded text you want to read. The harness re-verifies the content hash before returning text; a mismatch returns status=uncitable.' },
      section: { type: 'string', description: 'Optional 10-K Item to read — "1" (Business), "1A" (Risk Factors), "7" (MD&A). Validated against the source\'s readable-section index; an unknown Item returns uncitable (not empty) with the available sections listed. Omit to get the section index.' },
      offset: { type: 'integer', description: 'Optional pagination offset (characters) for documents that do not parse into Items.' },
      limit: { type: 'integer', description: 'Optional maximum characters to return for this read.' },
    },
  },
}

export type GroundedToolDeps = {
  /** Mechanism-6 lane id; fetch_source is gated by this lane's source-discipline whitelist BEFORE fetching. */
  lane?: string
  /** Grounding fn (injectable for tests). Defaults to the live groundProposedSources (SSRF + sha256 + ledger). */
  ground?: GroundFn
  /** Extra grounding deps (fetch impl, timeouts, excerpt length). */
  grounding?: GroundingDeps
  /** EDGAR fetcher for search_filings (injectable for tests). Defaults to the live fetchCompanyFundamentals. */
  fetchFundamentals?: (ticker: string, deps?: SecEdgarDeps) => Promise<Fundamentals | undefined>
  /** Max chars of the captured excerpt returned to the model per fetch_source (keeps context bounded). */
  maxExcerptChars?: number
  /**
   * Already-grounded sources the model may READ via read_source (e.g. the harness-pre-verified EDGAR
   * 10-K, plus prior lanes' captures). Merged with this loop's own fetch_source captures. The read is
   * still hash-verified and lane-gated, so a source here is no more permissive than a cited one.
   */
  readCorpus?: ReadonlyMap<string, CapturedSource>
}

export type GroundedToolExecutor = {
  /** The injected executor handed to provider.runToolLoop. */
  executor: ProviderToolExecutor
  /** Sources captured (content-hashed) across all fetch_source calls — feeds the SAME source ledger. */
  captured: CapturedSource[]
  /** Verified (available) source ids — the ONLY ids a Phase-2 finding may legitimately cite. */
  verified_ids: string[]
  /** Sources rejected by the per-lane source-discipline whitelist (visible, never silently dropped). */
  policy_rejections: SourcePolicyRejection[]
}

const DEFAULT_TOOL_EXCERPT_CHARS = 1_200
let toolSourceCounter = 0

/**
 * Build the harness-owned grounded tool executor + the accumulators it fills. fetch_source routes a url
 * through groundProposedSourcesForLane (the per-lane whitelist gate + SSRF + sha256 + ledger capture) and
 * returns the model a TRUNCATED excerpt of the captured bytes + the VERIFIED source_id + availability —
 * accumulating captured/verified/rejections. search_filings routes a ticker through secEdgar and returns
 * candidate filing urls for DISCOVERY only (not citable until fetched via fetch_source).
 */
export function buildGroundedToolExecutor(deps: GroundedToolDeps = {}): GroundedToolExecutor {
  const ground = deps.ground ?? groundProposedSources
  const fetchFundamentals = deps.fetchFundamentals ?? fetchCompanyFundamentals
  const lane = deps.lane
  const excerptChars = deps.maxExcerptChars ?? DEFAULT_TOOL_EXCERPT_CHARS

  const captured: CapturedSource[] = []
  const verified = new Set<string>()
  const policy_rejections: SourcePolicyRejection[] = []
  const seenUrls = new Map<string, string>()

  const executor: ProviderToolExecutor = async (toolName, args) => {
    if (toolName === 'fetch_source') {
      const url = typeof (args as { url?: unknown })?.url === 'string' ? (args as { url: string }).url.trim() : ''
      if (url.length === 0) {
        return 'TOOL ERROR: fetch_source requires a non-empty `url` argument (an absolute https URL of a primary source).'
      }
      // Reuse a prior fetch of the same url so the model can re-read without re-spending grounding.
      const priorId = seenUrls.get(url)
      if (priorId !== undefined) {
        const prior = captured.find((c) => c.source_id === priorId)
        if (prior !== undefined) {
          return formatFetchResult(prior, verified.has(priorId), excerptChars)
        }
      }
      const sourceId = `tool_src_${++toolSourceCounter}`
      const proposed: ProposedSource = {
        source_id: sourceId,
        title: url,
        url,
        excerpt: `Model-requested primary source: ${url}`,
      }
      const result = lane !== undefined
        ? await groundProposedSourcesForLane(lane, [proposed], { ...deps.grounding, ground })
        : { ...(await ground([proposed], deps.grounding)), policy_rejections: [] as SourcePolicyRejection[] }

      for (const rej of result.policy_rejections) policy_rejections.push(rej)
      if (result.policy_rejections.some((r) => r.source_id === sourceId)) {
        const rej = result.policy_rejections.find((r) => r.source_id === sourceId)!
        return `REJECTED: ${url} was excluded by this lane's source-discipline policy (${rej.reason}). Cite a PRIMARY source (e.g. an SEC filing) instead.`
      }
      const cap = result.captured.find((c) => c.source_id === sourceId)
      if (cap === undefined) {
        return `UNAVAILABLE: ${url} could not be grounded. Try a different primary source.`
      }
      captured.push(cap)
      seenUrls.set(url, sourceId)
      const isVerified = result.verified_ids.includes(sourceId)
      if (isVerified) verified.add(sourceId)
      return formatFetchResult(cap, isVerified, excerptChars)
    }

    if (toolName === 'search_filings') {
      const ticker = typeof (args as { ticker?: unknown })?.ticker === 'string' ? (args as { ticker: string }).ticker.trim() : ''
      if (ticker.length === 0) {
        return 'TOOL ERROR: search_filings requires a non-empty `ticker` argument.'
      }
      let fundamentals: Fundamentals | undefined
      try {
        fundamentals = await fetchFundamentals(ticker)
      } catch {
        fundamentals = undefined
      }
      if (fundamentals === undefined || fundamentals.filings.length === 0) {
        return `NO FILINGS FOUND for ${ticker} on SEC EDGAR. This may be a non-US filer; try fetch_source on a known primary-source URL instead.`
      }
      const lines = fundamentals.filings
        .slice(0, 10)
        .map((f) => `- ${f.form} filed ${f.filed}: ${f.url}`)
      return (
        `SEC EDGAR filings for ${fundamentals.entity_name} (CIK ${fundamentals.cik}) — DISCOVERY ONLY, not citable until fetched:\n`
        + lines.join('\n')
        + `\n\nTo cite any of these, call fetch_source with its URL.`
      )
    }

    if (toolName === 'read_source') {
      const a = args as { source_id?: unknown; section?: unknown; offset?: unknown; limit?: unknown }
      const sourceId = typeof a?.source_id === 'string' ? a.source_id.trim() : ''
      if (sourceId.length === 0) {
        return 'TOOL ERROR: read_source requires a non-empty `source_id` argument (a verified source_id from a prior fetch_source or the pre-verified primary-sources block).'
      }
      // Effective corpus: harness-supplied pre-grounded sources overlaid with this loop's own captures.
      const readCorpus = new Map<string, CapturedSource>(deps.readCorpus ?? [])
      for (const c of captured) readCorpus.set(c.source_id, c)

      const readOpts: ReadSourceOptions = {
        ...(typeof a.section === 'string' && a.section.trim().length > 0 ? { section: a.section.trim() } : {}),
        ...(typeof a.offset === 'number' && Number.isFinite(a.offset) ? { offset: a.offset } : {}),
        ...(typeof a.limit === 'number' && Number.isFinite(a.limit) ? { limit: a.limit } : {}),
        ...(lane !== undefined ? { lane } : {}),
      }
      const read = await readGroundedSource(sourceId, readCorpus, readOpts, deps.grounding)
      if (!read.ok) {
        // Anti-laundering: a failed/uncitable read NEVER adds the id to verified_ids.
        return formatReadFailure(sourceId, read.reason, read.available_items)
      }
      // A successful read is hash-verified AND in-lane → the source is citable in this loop.
      verified.add(sourceId)
      return formatReadResult(read)
    }

    return `TOOL ERROR: unknown tool ${toolName}.`
  }

  return {
    executor,
    captured,
    get verified_ids() {
      return [...verified]
    },
    policy_rejections,
  }
}

/** Format a captured source as the bounded tool result string returned to the model. */
function formatFetchResult(cap: CapturedSource, isVerified: boolean, excerptChars: number): string {
  const status = isVerified ? 'available' : 'unavailable'
  const excerpt = cap.excerpt.slice(0, excerptChars)
  const head = `FETCHED source_id=${cap.source_id} status=${status} url=${cap.url}`
  if (!isVerified) {
    return `${head}\n(The source could not be content-verified; you may NOT cite ${cap.source_id}. Try another primary source.)`
  }
  return `${head}\ncontent_hash=${cap.content_hash ?? 'n/a'}\nexcerpt: ${excerpt}`
}

/** Format a successful read_source result (hash-verified, in-lane) for the model. */
function formatReadResult(read: Extract<ReadSourceResult, { ok: true }>): string {
  const sectionLabel = read.section !== undefined ? ` section=${read.section}` : ''
  const itemsLine = read.available_items !== undefined ? `\nreadable_sections: ${read.available_items.join(', ')}` : ''
  const more = read.truncated === true ? `\n(truncated — continue with offset=${read.next_offset})` : ''
  return `READ source_id=${read.source_id}${sectionLabel} status=available${itemsLine}\n${read.text}${more}`
}

/**
 * Format a failed/uncitable read_source result. The explicit `content_hash_mismatch` code is the
 * executor-layer twin of the read-layer anti-laundering guard: the model is told the source is NOT
 * readable, never handed the stale excerpt or an unverified copy.
 */
function formatReadFailure(sourceId: string, reason: string, availableItems?: string[]): string {
  const code = reason.includes('content-verified for reading') ? 'content_hash_mismatch'
    : reason.includes('not found in the verified corpus') ? 'unknown_source_id'
    : reason.startsWith('excluded_by_lane_policy') ? reason
    : reason.startsWith('section "') ? 'section_not_found'
    : reason
  const itemsLine = availableItems !== undefined && availableItems.length > 0
    ? ` available_sections=${availableItems.join(',')}`
    : ''
  return `READ source_id=${sourceId} status=uncitable reason=${code}${itemsLine}`
}

/**
 * Run a grounded agent via the multi-step tool loop WHEN the provider supports it, else fall back to the
 * existing structured propose-then-verify path UNCHANGED. The loop (Phase 1 gather + Phase 2 synthesis)
 * lets a non-browsing model gather REAL primary sources instead of proposing urls from memory. Either way
 * the returned captured/verified sources feed the SAME post-hoc verification + source ledger, and the
 * per-lane source-discipline whitelist gates fetch_source as an ADDITIONAL grounding gate.
 */
export async function runGroundedAgentWithTools<T extends { proposed_sources: z.infer<typeof ProposedSourcesSchema> }>(
  provider: Provider,
  request: GroundedAgentRequest,
  schema: ZodType<T>,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; fetchFundamentals?: (ticker: string, d?: SecEdgarDeps) => Promise<Fundamentals | undefined>; maxToolCalls?: number } = {},
  opts: { lane?: string } = {},
): Promise<GroundedAgentResult<T> & { degraded_no_tools: boolean }> {
  const supportsLoop = provider.capabilities['multi-step-tool-loop'] !== 'unsupported' && typeof provider.runToolLoop === 'function'
  if (!supportsLoop) {
    // Fallback: the existing propose-then-verify path, behavior UNCHANGED.
    const result = await runGroundedAgent(provider, request, schema, { ...(deps.ground === undefined ? {} : { ground: deps.ground }), ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }) }, opts)
    return { ...result, degraded_no_tools: false }
  }

  const tool = buildGroundedToolExecutor({
    ...(opts.lane === undefined ? {} : { lane: opts.lane }),
    ...(deps.ground === undefined ? {} : { ground: deps.ground }),
    ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
    ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
  })

  const loop = await provider.runToolLoop!(
    {
      run_id: request.run_id,
      model_id: request.model_id,
      task_kind: 'tool-loop',
      prompt: request.prompt,
      timeout_ms: request.timeout_ms,
      budget: { max_tool_calls: deps.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS, max_tokens: 8_000 },
      tool_allowlist: [...GROUNDED_TOOL_NAMES],
      tool_parameters: GROUNDED_TOOL_PARAMETERS,
      response_format: { kind: 'json-schema', schema_name: request.schema_name ?? 'GroundedAgent' },
    },
    schema,
    tool.executor,
  )

  // The harness-accumulated captured/verified sources are the AUTHORITATIVE grounding set — the analysis
  // may cite only ids in tool.verified_ids (post-hoc verification by the caller still enforces this).
  return {
    analysis: loop.analysis,
    captured: tool.captured,
    verified_ids: tool.verified_ids,
    policy_rejections: tool.policy_rejections,
    degraded_no_tools: loop.degraded_no_tools,
  }
}

/** Default Phase-1 gather cap for research lanes (≤ this many real fetch/search calls per lane). */
export const DEFAULT_MAX_TOOL_CALLS = 10

// judgment-objectivity-layer-spec Mechanism 5: the synthesis response to the red team's strongest
// objection (echoed into the verdict). Lives here (a cycle-free module) because BOTH researchSwarm's
// DecisionAgentSchema and redTeamPass reference it at module-eval — keeping it here avoids a circular
// module-evaluation dependency between those two modules.
export const SynthesisResponseSchema = z.object({
  mode: z.enum(['answered_with_evidence', 'accepted_downgraded']),
  text: z.string().min(1),
  downgrade: z
    .object({
      dimension: z.enum(['tier', 'growth', 'verdict']),
      from: z.string().min(1),
      to: z.string().min(1),
    })
    .optional(),
})
export type SynthesisResponse = z.infer<typeof SynthesisResponseSchema>
