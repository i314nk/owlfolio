import { z, type ZodType } from 'zod'
import type { Provider } from '@owlfolio/providers'
import {
  runGroundedAgent,
  type GroundedAgentRequest,
  type GroundedAgentResult,
  type GroundFn,
  type ProposedSourcesSchema,
} from './groundedAgent'
import type { GroundingDeps } from './sourceGrounding'

// ---------------------------------------------------------------------------
// Harness defense 1 (model-tiering-spec) — SCHEMA VALIDATION + RETRY.
//
// "output validated against the lane's JSON schema; failures bounced back with the error; 2 failures =
// lane run marked FAILED (never passed through)."
//
// This is the SYSTEMATIC fix for the live-dogfood silent-degradation gap: a capable model left the
// (optional-on-the-schema) high-stakes fields — moat_rubric, synthesis_response (when a red-team
// objection exists), the shariah overlay (impermissible_income), runway — BLANK, so the harness
// rubric/Shariah/red-team mechanisms quietly skipped. provider.structured() already validates the Zod
// schema (and throws on a mismatch), but those fields are OPTIONAL there, so omission passed through.
//
// runValidatedAgent adds a second gate: after the schema parse, it checks a set of `requiredFields`
// predicates (the high-stakes fields). If any is missing, it RETRIES — bouncing the SPECIFIC missing
// fields back into the prompt ("your previous output failed: …; emit valid JSON including <fields>") so
// a capable model is FORCED to emit them. After 2 failed attempts (initial + 1 retry) the stage is
// marked FAILED (recorded — never passed through as if complete).
//
// Precedence reconciled with the existing visible-degradation stopgap (documented in researchSwarm):
//   retry FIRST (force the model) → if still missing after 2 tries, the caller FALLS BACK to the
//   existing visible-degradation path (holistic moat/lane Shariah/red_team_objection_unaddressed flag)
//   so the RUN still completes. Retries force compliance; the fallback prevents an abort; either way
//   the gap is VISIBLE — never silent, never a whole-run abort.
// ---------------------------------------------------------------------------

type WithProposedSources = { proposed_sources: z.infer<typeof ProposedSourcesSchema> }

/** A high-stakes field the validator REQUIRES even though it is optional on the Zod schema. */
export type RequiredFieldCheck<T> = {
  /** The field name surfaced in the bounced error + the failed result (e.g. 'moat_rubric'). */
  name: string
  /** Returns true when the field is present/usable on the parsed analysis. */
  present: (analysis: T) => boolean
  /** Optional extra guidance appended to the bounce ("…including a citation_hash for cited rows"). */
  hint?: string
}

/** Successful validated run — the grounded result plus the attempt count. */
export type ValidatedAgentOk<T extends WithProposedSources> = {
  status: 'ok'
  result: GroundedAgentResult<T>
  attempts: number
}

/** Failed validated run — retries exhausted; the caller falls back VISIBLY (never silent). */
export type ValidatedAgentFailed<T extends WithProposedSources> = {
  status: 'failed'
  attempts: number
  /** The required field names still missing after the final attempt. */
  missing: string[]
  /** The last validation/provider error message (for the dossier flag). */
  reason: string
  /** The last grounded result, if one parsed (so the caller can still use the degraded payload). */
  lastResult?: GroundedAgentResult<T>
}

export type ValidatedAgentOutcome<T extends WithProposedSources> = ValidatedAgentOk<T> | ValidatedAgentFailed<T>

/** Thrown by runValidatedAgent when `throwOnFailed` is set and retries are exhausted. */
export class ValidatedAgentFailedError extends Error {
  readonly missing: string[]
  readonly attempts: number
  constructor(missing: string[], attempts: number, reason: string) {
    super(`Validated agent run FAILED after ${attempts} attempts — missing required fields [${missing.join(', ')}]: ${reason}`)
    this.name = 'ValidatedAgentFailedError'
    this.missing = missing
    this.attempts = attempts
  }
}

export type RunValidatedAgentOptions<T extends WithProposedSources> = {
  ground?: GroundFn
  grounding?: GroundingDeps
  /** Mechanism-6 lane id (threaded straight to runGroundedAgent for per-lane source gating). */
  lane?: string
  /** High-stakes fields forced present by retry (the dogfood fix). Empty = schema validation only. */
  requiredFields?: RequiredFieldCheck<T>[]
  /** Total attempts before FAILED. Default 2 (initial + 1 retry) per the spec ("2 failures = FAILED"). */
  maxAttempts?: number
  /** When true, throw {@link ValidatedAgentFailedError} instead of returning a failed outcome. */
  throwOnFailed?: boolean
}

function buildBounce<T>(basePrompt: string, missing: RequiredFieldCheck<T>[], reason: string): string {
  const fieldList = missing.map((f) => (f.hint !== undefined ? `${f.name} (${f.hint})` : f.name)).join(', ')
  return (
    `${basePrompt}\n\nRETRY — your previous output failed validation: ${reason}. `
    + `You MUST emit valid JSON that includes the following REQUIRED field(s) you omitted: ${fieldList}. `
    + `Do not omit them again — these fields are mandatory for this analysis.`
  )
}

/**
 * Run a grounded agent under schema-validation + retry. Calls {@link runGroundedAgent}; on a thrown
 * schema/provider error OR a missing required field, retries with the specific error bounced into the
 * prompt. After {@link RunValidatedAgentOptions.maxAttempts} attempts it returns a `failed` outcome
 * (or throws when `throwOnFailed`). Grounding/citation verification is unchanged (delegated wholesale).
 */
export async function runValidatedAgent<T extends WithProposedSources>(
  provider: Provider,
  request: GroundedAgentRequest,
  schema: ZodType<T>,
  options: RunValidatedAgentOptions<T> = {},
): Promise<ValidatedAgentOutcome<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2)
  const required = options.requiredFields ?? []
  const deps = {
    ...(options.ground === undefined ? {} : { ground: options.ground }),
    ...(options.grounding === undefined ? {} : { grounding: options.grounding }),
  }
  const groundOpts = options.lane === undefined ? {} : { lane: options.lane }

  let attempts = 0
  let lastReason = 'unknown'
  let lastMissingNames: string[] = required.map((f) => f.name)
  let lastResult: GroundedAgentResult<T> | undefined
  let prompt = request.prompt

  while (attempts < maxAttempts) {
    attempts++
    try {
      const result = await runGroundedAgent(provider, { ...request, prompt }, schema, deps, groundOpts)
      lastResult = result
      const missing = required.filter((f) => !f.present(result.analysis))
      if (missing.length === 0) {
        return { status: 'ok', result, attempts }
      }
      lastMissingNames = missing.map((f) => f.name)
      lastReason = `missing required field(s): ${lastMissingNames.join(', ')}`
      // Bounce the specific missing fields back into the prompt for the next attempt.
      prompt = buildBounce(request.prompt, missing, lastReason)
    } catch (error) {
      // A schema/provider throw (invalid JSON, schema mismatch) is a failed attempt — retry, bouncing
      // the error back. The required-field list is unknown here, so re-prompt for all required fields.
      lastReason = error instanceof Error ? error.message : String(error)
      lastResult = undefined
      lastMissingNames = required.map((f) => f.name)
      prompt = required.length > 0 ? buildBounce(request.prompt, required, lastReason) : `${request.prompt}\n\nRETRY — your previous output failed validation: ${lastReason}. Emit valid JSON matching the schema.`
    }
  }

  if (options.throwOnFailed === true) {
    throw new ValidatedAgentFailedError(lastMissingNames, attempts, lastReason)
  }
  return {
    status: 'failed',
    attempts,
    missing: lastMissingNames,
    reason: lastReason,
    ...(lastResult === undefined ? {} : { lastResult }),
  }
}
