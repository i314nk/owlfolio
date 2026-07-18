import { z } from 'zod'

import type { Provider } from '@owlfolio/providers'

import { AGENT_TIMEOUT_MS } from './researchSwarmSchemas'

// ---------------------------------------------------------------------------
// FOCUSED Arabic prose rendering (owner, 2026-07-18 — task #88).
//
// When the app language is Arabic, the dossier's synthesis PROSE is rendered in Arabic by a small
// dedicated call AFTER the decision is final. Deliberately a FOCUSED pass (the same decomposition
// that got the moat rubric / red-team response / valuation reasoning emitting reliably) — never a
// field bolted onto the monolithic synthesis schema, which live models under-fill.
//
// Contract:
//  - INPUT is the FINAL composed English prose (including harness-authored gate/clamp prefixes),
//    so the Arabic reader gets the same message the English record carries.
//  - It is a RENDERING, not a new analysis: no tools, no grounding, no new claims. Tickers,
//    verdict enums, ratios, filing names, and source_ids stay in Latin script as-is.
//  - FAIL-OPEN: any failure (after one retry) returns undefined and the run completes with
//    English-only prose — a translation nicety must never fail an analysis.
//  - The ENGLISH record remains authoritative; the UI labels the Arabic rendering as such.
// ---------------------------------------------------------------------------

export const ArabicProseSchema = z.object({
  decision_reason: z.string().min(1),
  thesis_summary: z.string().min(1),
  evidence_summary: z.string().min(1),
  valuation_rationale: z.string().min(1),
  shariah_rationale: z.string().min(1),
  synthesis_summary: z.string().min(1),
})
export type ArabicProse = z.infer<typeof ArabicProseSchema>

export type RunArabicProsePassArgs = {
  research_case_id: string
  model_id: string
  ticker: string
  /** The FINAL composed English prose fields (post-gate/clamp composition). */
  prose: ArabicProse
}

function buildArabicProsePrompt(args: RunArabicProsePassArgs): string {
  return [
    `You render an investment dossier's prose into Modern Standard Arabic for ${args.ticker}.`,
    'This is a faithful rendering of an ALREADY-AUDITED analysis — do NOT add, remove, soften, or strengthen any claim, figure, or caveat. You are a translator here, not an analyst.',
    'Rules:',
    '- Use the professional financial register of Arabic investment research.',
    '- Use canonical AAOIFI / fiqh terminology for Shariah concepts (e.g. أيوفي، النقاء، النسب المالية الشرعية) — never improvised renderings.',
    '- Keep tickers, company names, verdict words (BUY / WATCH / PASS / RESEARCH_MORE), filing names (10-K, 10-Q, DEF 14A), ratios, dollar figures, and source_ids in Latin script exactly as written.',
    '- Every field must be rendered; never leave one empty.',
    'The English record remains authoritative; your rendering is a reading aid.',
    '',
    'Render these six fields (JSON in, JSON out — same keys):',
    JSON.stringify(args.prose, null, 2),
  ].join('\n')
}

/**
 * Render the six synthesis prose fields into Arabic. One retry on any error; exhausted → undefined
 * (fail-open — the caller records English-only prose and the run completes normally).
 */
export async function runArabicProsePass(
  provider: Provider,
  args: RunArabicProsePassArgs,
): Promise<ArabicProse | undefined> {
  const request = {
    run_id: `run_${args.research_case_id}_arabic_prose`,
    provider_id: provider.provider_id,
    model_id: args.model_id,
    task_kind: 'structured-output' as const,
    prompt: buildArabicProsePrompt(args),
    timeout_ms: AGENT_TIMEOUT_MS,
    budget: { max_tool_calls: 0, max_tokens: 4000 },
    tool_allowlist: [],
    response_format: { kind: 'json-schema' as const, schema_name: 'ArabicDossierProse' },
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await provider.structured(request, ArabicProseSchema)
    } catch {
      // Retry once; a second failure falls through to the fail-open undefined.
    }
  }
  return undefined
}
