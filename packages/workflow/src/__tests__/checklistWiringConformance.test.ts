import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CHECKLIST_PARAMS, listCognitiveItems } from '@owlfolio/strategies/checklistParams'

// ---------------------------------------------------------------------------------------------------
// CHECKLIST WIRING-CONFORMANCE TRIPWIRE (rescoped after the REVIEW RETIREMENT, owner 2026-07-14).
//
// The re-underwrite sign-off flows (confirm/override holding review) are GONE — with them went the
// completion evaluator (`evaluateChecklistCompletion`) and the two re-underwrite checklist forms.
// What SURVIVES of the Phase-7 checklist is the DATA + EVIDENCE layer: CHECKLIST_PARAMS as the single
// source of the hygiene prompts (rendered live on Learn/Strategy), and the server-side findings
// marshal (resolveBusinessFindings) that annotates the ADMIT checkpoint. These invariants still hold:
//
//   B1. DECISION-NEUTRAL (no-scoring) — the params + the evidence layer carry NO scoring/tally
//       identifier (a count is a score in disguise).
//   B2. COGNITIVE-HUMAN-ONLY — every cognitive item in CHECKLIST_PARAMS carries NO `reads` field, so
//       the evidence layer can never marshal it; the findings layer iterates listBusinessItems() only
//       (the agent has no path to author a human-only cognitive answer).
//   B3. EXTENSIBLE — the findings layer iterates the data source, never a hardcoded per-item id list.
//   B4. ADMISSION STAYS UNGATED — review-and-promote: the promote is the human commitment; the
//       admission host must NOT call a checklist completion evaluator (which no longer exists).
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

const watchlistWorkflowSrc = readWorkflowSrc('watchlistWorkflow.ts')
const checklistParamsSrc = readStrategySrc('checklistParams.ts')
const evidenceSrc = readWebSrc('lib', 'checklistEvidence.ts')
const watchlistPromotionFormSrc = readWebSrc('components', 'WatchlistPromotionForm.tsx')

/** Strip block (`/* … *\/`) + line (`// …`) comments so structural greps target CODE, not prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('checklist wiring conformance — B1: decision-neutral (no scoring)', () => {
  const SCORING_IDENTIFIERS = /\b(score|scoring|tally|weighted_total|points|grade)\b/i

  it('the params + the evidence layer carry NO scoring/tally identifier', () => {
    for (const src of [checklistParamsSrc, evidenceSrc]) {
      expect(stripComments(src)).not.toMatch(SCORING_IDENTIFIERS)
    }
  })

  it('the promote form renders NO count/progress badge over checklist items', () => {
    expect(stripComments(watchlistPromotionFormSrc)).not.toMatch(/\b(answered|completed)\s*[/of]\s*(total|items)\b/i)
  })
})

describe('checklist wiring conformance — B2: cognitive items are HUMAN-ONLY (never agent-fed)', () => {
  it('EVERY cognitive item in CHECKLIST_PARAMS carries NO `reads` field (so evidence can never marshal it)', () => {
    for (const item of listCognitiveItems(CHECKLIST_PARAMS)) {
      expect((item as { reads?: unknown }).reads).toBeUndefined()
    }
  })

  it('the evidence layer iterates listBusinessItems() only — never the cognitive list', () => {
    const code = stripComments(evidenceSrc)
    expect(code).not.toContain('listCognitiveItems(')
    for (const item of listCognitiveItems(CHECKLIST_PARAMS)) {
      expect(code).not.toContain(`'${item.id}'`)
    }
  })
})

describe('checklist wiring conformance — B3: extensible (iterates the data, no hardcoded list)', () => {
  it('the web findings layer iterates the data source (listBusinessItems / CHECKLIST_PARAMS.items)', () => {
    const code = stripComments(evidenceSrc)
    expect(/listBusinessItems\(|CHECKLIST_PARAMS\.items/.test(code)).toBe(true)
  })
})

describe('checklist wiring conformance — B4: admission stays ungated (review-and-promote)', () => {
  it('admission (confirmWatchlistDraft) does NOT call a checklist completion evaluator', () => {
    expect(stripComments(watchlistWorkflowSrc)).not.toContain('evaluateChecklistCompletion(')
  })
})
