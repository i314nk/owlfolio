import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'

// ---------------------------------------------------------------------------------------------------
// Phase 7 S5 — CHECKLIST WIRING-CONFORMANCE TRIPWIRE (the 4th application of the "built-but-unwired"
// guard, mirroring admit / sizing / sell WiringConformance).
//
// SOURCE-LEVEL assertions (a grep over the COMMITTED non-test source) that the Phase-7 hygiene/bias
// checklist is REACHABLE from EVERY live sign-off flow and that its load-bearing invariants hold in the
// committed code, not just in the unit tests:
//
//   A1. REACHABLE in BOTH sign-off flows — admission (confirmWatchlistDraft) AND re-underwrite (BOTH
//       confirmHoldingReviewDraft AND overrideHoldingReviewDraft) each call evaluateChecklistCompletion(
//       and BLOCK on it (a throw on `!...complete`). The web routes/fns wire each host.
//   A2. DECISION-NEUTRAL (no-scoring) — ENGINE + the three sign-off hosts + the evidence layer carry NO
//       scoring/tally identifier (mirrors the no-Kelly grep), AND the three checklist UI forms render NO
//       count/progress badge (a count is a score in disguise).
//   A3. COGNITIVE-HUMAN-ONLY — no host/route/workflow pre-fills or suggests cognitive answers, and the
//       cognitive items in CHECKLIST_PARAMS carry NO `reads` field (so the evidence layer can never
//       marshal them). The forms seed every answer EMPTY.
//   A4. EXTENSIBLE — the evaluator iterates CHECKLIST_PARAMS.items (no hardcoded per-item id list in the
//       evaluator OR the hosts), so a newly-added item is automatically required with no code change.
//
// If a future edit makes the checklist an island in any flow (a host stops calling the evaluator, a
// route stops calling the host), or smuggles a score/count/tally into the engine/hosts/forms, or
// pre-fills cognitive answers, or hardcodes the item list — this trips.
// ---------------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const workflowSrc = join(here, '..')
const repoRoot = join(workflowSrc, '..', '..', '..')

function readWorkflowSrc(file: string): string {
  return readFileSync(join(workflowSrc, file), 'utf8')
}
function readStrategySrc(file: string): string {
  return readFileSync(join(repoRoot, 'packages', 'strategies', 'src', file), 'utf8')
}
function readWebSrc(...segments: string[]): string {
  return readFileSync(join(repoRoot, 'apps', 'web', 'src', ...segments), 'utf8')
}

// --- host sources (the three live sign-off flows) ---
const watchlistWorkflowSrc = readWorkflowSrc('watchlistWorkflow.ts')
const holdingReviewWorkflowSrc = readWorkflowSrc('holdingReviewWorkflow.ts')
// --- engine + evidence layer ---
const checklistEngineSrc = readStrategySrc('checklist.ts')
const checklistParamsSrc = readStrategySrc('checklistParams.ts')
const evidenceSrc = readWebSrc('lib', 'checklistEvidence.ts')
// --- web wiring (routes + fns) ---
const webWorkflowSrc = readWebSrc('lib', 'workflow.ts')
const watchlistRouteSrc = readWebSrc('app', 'api', 'research', '[caseId]', 'watchlist', 'route.ts')
const reviewConfirmRouteSrc = readWebSrc(
  'app', 'api', 'portfolio', '[holdingId]', 'review', '[reviewId]', 'confirm', 'route.ts',
)
const reviewOverrideRouteSrc = readWebSrc(
  'app', 'api', 'portfolio', '[holdingId]', 'review', '[reviewId]', 'override', 'route.ts',
)
// --- the three checklist UI forms ---
const watchlistPromotionFormSrc = readWebSrc('components', 'WatchlistPromotionForm.tsx')
const holdingReviewConfirmFormSrc = readWebSrc('components', 'HoldingReviewChecklistConfirm.tsx')
const holdingReviewOverrideFormSrc = readWebSrc('components', 'HoldingReviewOverrideForm.tsx')

/** Strip block (`/* … *\/`) + line (`// …`) comments so structural greps target CODE, not prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Isolate an `export (async) function NAME` body so structural greps target the slice. Stops at the next
 * top-level declaration (column 0), so an unrelated helper between this fn and the next export cannot
 * leak in and produce a false positive/negative.
 */
function functionSlice(src: string, signature: string): string {
  const start = src.indexOf(signature)
  if (start === -1) return ''
  const rest = src.slice(start + signature.length)
  const boundary = rest.search(/\n(?:export |async function |function |const |class )/)
  return boundary === -1 ? src.slice(start) : src.slice(start, start + signature.length + boundary)
}

describe('Phase 7 S5 wiring conformance — A1: the checklist gates EVERY live sign-off flow', () => {
  it('admission (confirmWatchlistDraft) calls evaluateChecklistCompletion AND blocks on it', () => {
    const slice = stripComments(functionSlice(watchlistWorkflowSrc, 'export async function confirmWatchlistDraft'))
    expect(slice, 'confirmWatchlistDraft must exist as a host slice').not.toBe('')
    expect(slice, 'admission must call evaluateChecklistCompletion').toMatch(/evaluateChecklistCompletion\(/)
    expect(slice, 'admission must BLOCK on the completion (throw on !complete)').toMatch(
      /if\s*\(\s*!\s*\w*[Cc]ompletion\.complete\s*\)[\s\S]*?throw\b/,
    )
  })

  it('re-underwrite confirm (confirmHoldingReviewDraft) calls evaluateChecklistCompletion AND blocks on it', () => {
    const slice = stripComments(
      functionSlice(holdingReviewWorkflowSrc, 'export async function confirmHoldingReviewDraft'),
    )
    expect(slice, 'confirmHoldingReviewDraft must exist as a host slice').not.toBe('')
    expect(slice, 'confirm must call evaluateChecklistCompletion').toMatch(/evaluateChecklistCompletion\(/)
    expect(slice, 'confirm must BLOCK on the completion (throw on !complete)').toMatch(
      /if\s*\(\s*!\s*\w*[Cc]ompletion\.complete\s*\)[\s\S]*?throw\b/,
    )
  })

  it('re-underwrite override (overrideHoldingReviewDraft) calls evaluateChecklistCompletion AND blocks on it', () => {
    const slice = stripComments(
      functionSlice(holdingReviewWorkflowSrc, 'export async function overrideHoldingReviewDraft'),
    )
    expect(slice, 'overrideHoldingReviewDraft must exist as a host slice').not.toBe('')
    expect(slice, 'override must call evaluateChecklistCompletion').toMatch(/evaluateChecklistCompletion\(/)
    expect(slice, 'override must BLOCK on the completion (throw on !complete)').toMatch(
      /if\s*\(\s*!\s*\w*[Cc]ompletion\.complete\s*\)[\s\S]*?throw\b/,
    )
  })

  it('the web routes/fns wire each host on a live path', () => {
    // Admission: route → promoteResearchCaseToWatchlist (web fn) → confirmWatchlistDraft (host).
    expect(watchlistRouteSrc).toMatch(/promoteResearchCaseToWatchlist\s*\(/)
    expect(webWorkflowSrc).toMatch(/confirmWatchlistDraft\s*\(/)
    // Re-underwrite confirm: route → confirmPersonalHoldingReviewDraft (web fn) → confirmHoldingReviewDraft.
    expect(reviewConfirmRouteSrc).toMatch(/confirmPersonalHoldingReviewDraft\s*\(/)
    expect(webWorkflowSrc).toMatch(/confirmHoldingReviewDraft\s*\(/)
    // Re-underwrite override: route → overridePersonalHoldingReviewDraft (web fn) → overrideHoldingReviewDraft.
    expect(reviewOverrideRouteSrc).toMatch(/overridePersonalHoldingReviewDraft\s*\(/)
    expect(webWorkflowSrc).toMatch(/overrideHoldingReviewDraft\s*\(/)
  })
})

describe('Phase 7 S5 wiring conformance — A2: decision-neutral (no scoring) in ENGINE + hosts + evidence + UI', () => {
  // Scoring/tally identifiers the checklist must NEVER contain — a count IS a score in disguise.
  const forbiddenScoring = /\bchecklist_score\b|\btally\b|\bpass_count\b|\bn_of_m\b|\bweighted\b|\bweight\b|\bscore\b/i

  it('the engine + the three sign-off hosts + the evidence layer carry NO scoring/tally identifier', () => {
    const codeSources: Array<{ name: string; src: string }> = [
      { name: 'checklist engine', src: checklistEngineSrc },
      { name: 'checklistParams', src: checklistParamsSrc },
      { name: 'confirmWatchlistDraft host', src: functionSlice(watchlistWorkflowSrc, 'export async function confirmWatchlistDraft') },
      { name: 'confirmHoldingReviewDraft host', src: functionSlice(holdingReviewWorkflowSrc, 'export async function confirmHoldingReviewDraft') },
      { name: 'overrideHoldingReviewDraft host', src: functionSlice(holdingReviewWorkflowSrc, 'export async function overrideHoldingReviewDraft') },
      { name: 'evidence layer', src: evidenceSrc },
    ]
    for (const { name, src } of codeSources) {
      expect(stripComments(src), `${name} CODE must contain no scoring/tally identifier`).not.toMatch(
        forbiddenScoring,
      )
    }
  })

  it('no host derives a verdict by .reduce(-ing over the checklist answers', () => {
    // A reduce over the answers feeding a verdict would re-introduce a tally. The decision-neutral
    // evaluator only iterates and pushes unaddressed ids; no host should fold the answers into a number.
    // The patterns catch both direct (`answers.X.reduce`) and Object.values/entries/keys-wrapped folds
    // (`Object.values(command.checklist_answers).reduce(...)`) regardless of the result variable name.
    const answersReduce =
      /checklist_answers\.[\s\S]*?\.reduce\(|(?<![A-Za-z_])answers\.[\s\S]*?\.reduce\(|\.(?:values|entries|keys)\([^)]*answers[^)]*\)[\s\S]{0,120}?\.reduce\(/
    for (const [name, src] of [
      ['confirmWatchlistDraft', functionSlice(watchlistWorkflowSrc, 'export async function confirmWatchlistDraft')],
      ['confirmHoldingReviewDraft', functionSlice(holdingReviewWorkflowSrc, 'export async function confirmHoldingReviewDraft')],
      ['overrideHoldingReviewDraft', functionSlice(holdingReviewWorkflowSrc, 'export async function overrideHoldingReviewDraft')],
    ] as const) {
      expect(stripComments(src), `${name} must not .reduce( over the answers into a verdict`).not.toMatch(answersReduce)
    }
    // The decision-neutral engine is tiny and must NEVER fold answers into a number — forbid ANY .reduce(
    // there outright (it iterates with for...of and pushes unaddressed ids; a reduce is a tally smell).
    expect(stripComments(checklistEngineSrc), 'the checklist engine must not .reduce( at all (no tally)').not.toMatch(
      /\.reduce\(/,
    )
  })

  it('the three checklist UI forms render NO count/progress badge', () => {
    // A "{n} of {m}", "/17", "remaining", "addressed} count" readout is a score in disguise. The ONLY
    // completeness signal is the disabled submit + the per-item "needs attention" marker.
    const countDisplay = [
      /of\s+17\b/i, // "of 17"
      /\bof\s+\d+\b/i, // "N of M" literal
      /\}\s*of\s*\{/, // "{addressed} of {total}"
      /\/\s*17\b/, // "/17"
      /\bremaining\b/i, // "N remaining"
      /\.length\s*\}\s*(?:of|\/|addressed|done|left|remaining)/i, // "{...length} of/done/left"
      /\baddressed\}\s*(?:of|\/|count)/i, // "{addressed} count"
    ]
    for (const [name, src] of [
      ['WatchlistPromotionForm', watchlistPromotionFormSrc],
      ['HoldingReviewChecklistConfirm', holdingReviewConfirmFormSrc],
      ['HoldingReviewOverrideForm', holdingReviewOverrideFormSrc],
    ] as const) {
      const code = stripComments(src)
      for (const pattern of countDisplay) {
        expect(code, `${name} must render no count/progress badge (matched ${pattern})`).not.toMatch(pattern)
      }
    }
  })
})

describe('Phase 7 S5 wiring conformance — A3: cognitive items are HUMAN-ONLY (never agent-fed)', () => {
  it('no host/route/web-workflow pre-fills or suggests checklist answers', () => {
    const forbiddenPrefill = /suggestChecklist|prefillChecklist|defaultChecklist|synthesizeChecklist|autofillChecklist/i
    for (const [name, src] of [
      ['confirmWatchlistDraft', functionSlice(watchlistWorkflowSrc, 'export async function confirmWatchlistDraft')],
      ['confirmHoldingReviewDraft', functionSlice(holdingReviewWorkflowSrc, 'export async function confirmHoldingReviewDraft')],
      ['overrideHoldingReviewDraft', functionSlice(holdingReviewWorkflowSrc, 'export async function overrideHoldingReviewDraft')],
      ['watchlist route', watchlistRouteSrc],
      ['review confirm route', reviewConfirmRouteSrc],
      ['review override route', reviewOverrideRouteSrc],
      ['web workflow (promote)', functionSlice(webWorkflowSrc, 'export async function promoteResearchCaseToWatchlist')],
    ] as const) {
      expect(stripComments(src), `${name} must not pre-fill/suggest checklist answers`).not.toMatch(
        forbiddenPrefill,
      )
    }
  })

  it('EVERY cognitive item in CHECKLIST_PARAMS carries NO `reads` field (so evidence can never marshal it)', () => {
    const cognitive = CHECKLIST_PARAMS.items.filter((item) => item.category === 'cognitive')
    expect(cognitive.length, 'there must be cognitive items to guard').toBeGreaterThan(0)
    for (const item of cognitive) {
      expect(item.reads, `cognitive item ${item.id} must have no reads (human-only)`).toBeUndefined()
    }
  })

  it('the evidence layer skips items with no `reads` (cognitive items are evidence-free by construction)', () => {
    // The evidence layer must continue/skip when reads is undefined — it can never marshal a cognitive item.
    const code = stripComments(evidenceSrc)
    expect(code, 'evidence layer must guard on reads === undefined').toMatch(
      /item\.reads\s*===\s*undefined|reads\b[\s\S]*?continue/,
    )
  })

  it('the three forms never seed the cognitive reflection (audit-and-decide: the single ack starts unchecked)', () => {
    for (const [name, src] of [
      ['WatchlistPromotionForm', watchlistPromotionFormSrc],
      ['HoldingReviewChecklistConfirm', holdingReviewConfirmFormSrc],
      ['HoldingReviewOverrideForm', holdingReviewOverrideFormSrc],
    ] as const) {
      const code = stripComments(src)
      // Audit-and-decide: the human posts exactly ONE cognitive-reflection acknowledgement, and it is NEVER
      // seeded — the ack state starts false (the agent must not pre-acknowledge the human's reflection).
      expect(code, `${name} must post the single cognitive acknowledgement`).toContain(
        'cognitive_reflection_acknowledged',
      )
      expect(code, `${name} must start the cognitive ack UNCHECKED (never seeded)`).toMatch(
        /useState\s*\(\s*false\s*\)/,
      )
      // The OLD per-item author inputs are GONE — the human never authors/seeds a per-item finding.
      expect(code, `${name} must not author per-item checklist notes`).not.toContain('checklist_note[')
      expect(code, `${name} must not author per-item checklist affirmations`).not.toContain('checklist_addressed[')
    }
  })
})

describe('Phase 7 S5 wiring conformance — A4: the checklist is extensible (iterates the data, no hardcoded list)', () => {
  it('the evaluator iterates CHECKLIST_PARAMS.items (no hardcoded per-item id list)', () => {
    const code = stripComments(checklistEngineSrc)
    // It must iterate the params data — either `…items` directly or via the data-derived `listBusinessItems(…)`
    // helper (audit-and-decide: the engine iterates the business items). Both are data-driven, not hardcoded.
    expect(code, 'evaluator must iterate params.items / CHECKLIST_PARAMS.items / listBusinessItems(…)').toMatch(
      /for\s*\(\s*const\s+\w+\s+of\s+(?:\w*\.?items\b|listBusinessItems\s*\()/,
    )
    // ...and must NOT enumerate item ids inline (a literal array of >=2 known item id strings).
    const knownIds = CHECKLIST_PARAMS.items.map((item) => item.id)
    const inlineIdListCount = knownIds.filter((id) => code.includes(`'${id}'`) || code.includes(`"${id}"`)).length
    expect(inlineIdListCount, 'evaluator must not hardcode checklist item ids').toBe(0)
  })

  it('no host enumerates the checklist item ids inline (the hosts defer entirely to the evaluator)', () => {
    const knownIds = CHECKLIST_PARAMS.items.map((item) => item.id)
    for (const [name, src] of [
      ['confirmWatchlistDraft', functionSlice(watchlistWorkflowSrc, 'export async function confirmWatchlistDraft')],
      ['confirmHoldingReviewDraft', functionSlice(holdingReviewWorkflowSrc, 'export async function confirmHoldingReviewDraft')],
      ['overrideHoldingReviewDraft', functionSlice(holdingReviewWorkflowSrc, 'export async function overrideHoldingReviewDraft')],
    ] as const) {
      const code = stripComments(src)
      const inlineIdCount = knownIds.filter((id) => code.includes(`'${id}'`) || code.includes(`"${id}"`)).length
      expect(inlineIdCount, `${name} must not enumerate checklist item ids inline`).toBe(0)
    }
  })
})
