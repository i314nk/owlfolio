import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------------------------------
// Phase 5 S7 — SIZING WIRING-CONFORMANCE TRIPWIRE (the 3rd application of the "built-but-unwired" guard,
// mirroring admitWiringConformance.test.ts).
//
// SOURCE-LEVEL assertions (a grep over the COMMITTED non-test source) that the S1–S5 sizing islands are
// REACHABLE from a LIVE path through the S6 assembler + the S7 route, not pure islands. Before S7,
// computeSizingRecommendation composed S1–S5 but was never called from a live (non-test) path — the route
// + web-workflow assertions below would have FAILED. They pass once the route → recordSizingRecommendation
// → computeSizingRecommendation chain is wired. If a future edit makes the assembler an island again (the
// assembler stops calling a cap, or the route stops calling the workflow), this trips.
//
// Plus the spec's hardest invariant made a CI tripwire: a STRUCTURAL NO-KELLY guard. The sizing sources
// must not contain any kelly / win_prob / odds / edge identifier — sizing is conviction × base weight
// capped by worst-case, NOT a probabilistic bet-sizing formula.
// ---------------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const workflowSrc = join(here, '..')
const repoRoot = join(workflowSrc, '..', '..', '..')

const assemblerSrc = readFileSync(join(workflowSrc, 'sizingAssessment.ts'), 'utf8')
const routeSrc = readFileSync(
  join(repoRoot, 'apps', 'web', 'src', 'app', 'api', 'research', '[caseId]', 'sizing', 'route.ts'),
  'utf8',
)
const webWorkflowSrc = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'workflow.ts'), 'utf8')

describe('Phase 5 S7 wiring conformance: the sizing assembler is reachable from a LIVE path', () => {
  it('the assembler calls all FOUR sizing islands (S1 conviction, S3 permanent-loss, S4 cluster, S5 hurdle)', () => {
    // Would have FAILED if the assembler ever stops composing one of the islands (an un-wired cap).
    expect(assemblerSrc).toMatch(/computeConvictionFactor\(/)
    expect(assemblerSrc).toMatch(/evaluatePermanentLossCap\(/)
    expect(assemblerSrc).toMatch(/evaluateClusterCap\(/)
    expect(assemblerSrc).toMatch(/evaluateDeploymentHurdle\(/)
  })

  it('the on-demand route + web workflow invoke the assembler on a live path', () => {
    // Both halves of the wiring are asserted so a break on either side (route → workflow, or workflow →
    // assembler) trips. Pre-S7 there was no sizing route and no recordSizingRecommendation — RED.
    expect(routeSrc).toMatch(/recordSizingRecommendation\s*\(/)
    expect(webWorkflowSrc).toMatch(/computeSizingRecommendation\s*\(/)
  })

  it('the route emits the sizing_recommendation_recorded OBSERVATION via the web workflow', () => {
    // The persisted artifact is emitted from the live path — not test-only scaffolding.
    expect(webWorkflowSrc).toContain('sizing_recommendation_recorded')
  })

  it('STRUCTURAL no-Kelly tripwire: no kelly / win_prob / odds / edge identifier in any sizing CODE', () => {
    // The spec's hardest invariant: sizing is conviction × base weight, worst-case-capped — NEVER a
    // probabilistic bet-sizing formula. A Kelly/odds/edge identifier creeping into any sizing source trips.
    //
    // We grep the CODE (comments stripped): the sizing sources deliberately DOCUMENT that they are the
    // anti-Kelly (prose mentions Kelly/odds/edge to explain what they are NOT), so a raw grep would be
    // hollow. Stripping comments targets actual identifiers — the thing the invariant forbids.
    const sizingSources: Array<{ name: string; src: string }> = [
      { name: 'convictionFactor', src: readStrategySrc('convictionFactor.ts') },
      { name: 'permanentLossCap', src: readStrategySrc('permanentLossCap.ts') },
      { name: 'correlatedClusters', src: readStrategySrc('correlatedClusters.ts') },
      { name: 'deploymentHurdle', src: readStrategySrc('deploymentHurdle.ts') },
      { name: 'sizingAssessment', src: assemblerSrc },
      { name: 'recordSizingRecommendation (web workflow)', src: recordSizingRecommendationSlice(webWorkflowSrc) },
    ]
    // Identifier-shaped matches (word-boundary), case-insensitive. `\bodds\b` / `\bedge\b` avoid matching
    // substrings inside unrelated words; kelly / win_prob are distinctive enough on their own.
    const forbidden = /\bkelly\b|\bwin_prob\b|\bodds\b|\bedge\b/i
    for (const { name, src } of sizingSources) {
      expect(stripComments(src), `${name} CODE must contain no Kelly/odds/edge identifier`).not.toMatch(forbidden)
    }
  })
})

function readStrategySrc(file: string): string {
  return readFileSync(join(repoRoot, 'packages', 'strategies', 'src', file), 'utf8')
}

/**
 * Strip block (`/* … *\/`) and line (`// …`) comments so the no-Kelly grep targets CODE only. The sizing
 * sources documentedly DESCRIBE themselves as the anti-Kelly (prose names Kelly/odds/edge to explain what
 * they refuse to be), so the structural invariant is about identifiers in code, not words in comments.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Isolate the recordSizingRecommendation function body so the no-Kelly grep targets the sizing slice. */
function recordSizingRecommendationSlice(src: string): string {
  const start = src.indexOf('export async function recordSizingRecommendation')
  if (start === -1) return src
  // Grab a generous slice from the function start to the next top-level export after it.
  const rest = src.slice(start + 'export async function recordSizingRecommendation'.length)
  const nextExport = rest.indexOf('\nexport ')
  return nextExport === -1 ? src.slice(start) : src.slice(start, start + 'export async function recordSizingRecommendation'.length + nextExport)
}
