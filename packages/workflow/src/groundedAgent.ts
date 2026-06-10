import { z, type ZodType } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { groundProposedSources, groundProposedSourcesForLane, type CapturedSource, type GroundingDeps, type ProposedSource, type SourcePolicyRejection } from './sourceGrounding'

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
