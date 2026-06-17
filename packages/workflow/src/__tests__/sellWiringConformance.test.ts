import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------------------------------
// Phase 6 S8a — SELL WIRING-CONFORMANCE TRIPWIRE (mirrors sizingWiringConformance.test.ts /
// admitWiringConformance.test.ts).
//
// SOURCE-LEVEL assertions (a grep over the COMMITTED non-test source) that the Phase-6 sell islands are
// REACHABLE from a LIVE path: the pure assembler (sellAssessment) composes the islands, the on-demand
// route calls recordSellDecision, and the web workflow calls computeSellDecision + emits the
// holding_sell_review_drafted OBSERVATION. If a future edit makes the assembler an island again (it stops
// composing an island, or the route stops calling the recorder), this trips.
//
// Plus the spec's load-bearing invariants made CI tripwires:
//   (a) no price-ALONE sell — the only price-driven sell rides through evaluateValuationInverted, which is
//       passed frozen_iv (never a bare current_price > / < comparison producing a sell);
//   (b) the guard consumes impairment_call and has NO age/clock release branch (no Date / month arithmetic);
//   (c) frozen-IV-not-live — recordSellDecision reads frozen_iv from a projection, never a fresh recompute;
//   (d) never auto-close — recordSellDecision / the route never append holding_closed or call closeHolding.
// ---------------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const workflowSrc = join(here, '..')
const repoRoot = join(workflowSrc, '..', '..', '..')

const assemblerSrc = readFileSync(join(workflowSrc, 'sellAssessment.ts'), 'utf8')
const guardSrc = readFileSync(join(repoRoot, 'packages', 'strategies', 'src', 'minimumHoldGuard.ts'), 'utf8')
const routeSrc = readFileSync(
  join(repoRoot, 'apps', 'web', 'src', 'app', 'api', 'research', '[caseId]', 'sell-decision', 'route.ts'),
  'utf8',
)
const webWorkflowSrc = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'workflow.ts'), 'utf8')

/** Strip block + line comments so structural greps target CODE, not documentation prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Isolate the recordSellDecision function body so structural greps target the sell slice. Stop at the
 * NEXT top-level function/const declaration (not the next `export`), so unrelated non-exported helpers
 * that happen to sit between recordSellDecision and the next export cannot leak into the slice and
 * produce a false positive/negative on the `frozen_iv`/`fair_value` greps.
 */
function recordSellDecisionSlice(src: string): string {
  const marker = 'export async function recordSellDecision'
  const start = src.indexOf(marker)
  if (start === -1) return src
  const rest = src.slice(start + marker.length)
  // The next top-level declaration begins at column 0 with one of these keywords.
  const boundary = rest.search(/\n(?:export |async function |function |const |class )/)
  return boundary === -1 ? src.slice(start) : src.slice(start, start + marker.length + boundary)
}

describe('Phase 6 S8a wiring conformance: the sell assembler is reachable from a LIVE path', () => {
  it('the assembler composes ALL FIVE sell islands (impairment, guard, valuationInverted, betterOpportunity, biasCaveats)', () => {
    expect(assemblerSrc).toMatch(/reassessHeldImpairment\(/)
    expect(assemblerSrc).toMatch(/applyMinimumHoldGuard\(/)
    expect(assemblerSrc).toMatch(/evaluateValuationInverted\(/)
    expect(assemblerSrc).toMatch(/evaluateBetterOpportunity\(/)
    expect(assemblerSrc).toMatch(/collectSellBiasCaveats\(/)
  })

  it('the on-demand route invokes recordSellDecision on a live path', () => {
    expect(routeSrc).toMatch(/recordSellDecision\s*\(/)
  })

  it('the web workflow invokes the assembler + emits the holding_sell_review_drafted OBSERVATION', () => {
    expect(webWorkflowSrc).toMatch(/computeSellDecision\s*\(/)
    expect(webWorkflowSrc).toContain('holding_sell_review_drafted')
  })

  it('STRUCTURAL (a) no price-ALONE sell: the only price→sell path is evaluateValuationInverted with the FROZEN reference', () => {
    // The valuation-inverted FLAG must be passed the SIGN-OFF-FROZEN reference (it compares the live price
    // against the frozen reference fair value, never a bare price move and never a recomputed live band). We
    // grep that the evaluateValuationInverted call site co-occurs with the frozen reference/oe_ps args.
    const code = stripComments(assemblerSrc)
    const invCall = /evaluateValuationInverted\(\s*\{[\s\S]*?frozen_reference_fair_value[\s\S]*?frozen_oe_ps[\s\S]*?\}\s*\)/
    expect(code, 'evaluateValuationInverted must be passed the frozen reference/oe_ps').toMatch(invCall)
    // And there is NO bare price comparison that produces a sell outside that call: no `current_price > ` /
    // `current_price < ` style comparison in the assembler code other than the documented `at_loss`
    // (current_price < cost_basis_per_share) loss check, which feeds the GUARD, never a sell directly.
    const priceComparisons = code.match(/current_price\s*[<>]=?/g) ?? []
    // The single allowed comparison is the at_loss loss-check against cost_basis_per_share.
    expect(priceComparisons.length, 'only the at_loss price comparison is allowed in the assembler').toBeLessThanOrEqual(1)
    if (priceComparisons.length === 1) {
      expect(code).toMatch(/current_price\s*<\s*args\.cost_basis_per_share/)
    }
  })

  it('STRUCTURAL (b) the guard consumes impairment_call and has NO age/clock release branch', () => {
    const code = stripComments(guardSrc)
    expect(code, 'guard must consume impairment_call').toMatch(/impairment_call/)
    // No age/clock identifier driving release: no holding_age_months, no Date arithmetic, no month math.
    expect(code, 'guard must not reference holding_age_months').not.toMatch(/holding_age_months/)
    expect(code, 'guard must not perform Date arithmetic').not.toMatch(/\bnew Date\b|\bDate\.now\b/)
    expect(code, 'guard must not perform month arithmetic for a release branch').not.toMatch(/minimum_hold_months/)
  })

  it('STRUCTURAL (c) frozen-reference-not-live: recordSellDecision reads the frozen reference/oe_ps from a projection, not a fresh recompute', () => {
    const slice = stripComments(recordSellDecisionSlice(webWorkflowSrc))
    // The frozen reference/oe_ps must be sourced from the nameLifecycle projection row, NOT a fresh recompute
    // (don't-move-the-number F.9/F.10): never a recomputed live valuation.
    expect(slice, 'recordSellDecision must read frozen_reference_fair_value from a projection row').toMatch(/\.frozen_reference_fair_value\b/)
    expect(slice, 'recordSellDecision must read frozen_oe_ps from a projection row').toMatch(/\.frozen_oe_ps\b/)
    // It must NOT recompute a sustainable band / fair value inline for the sell decision.
    expect(slice, 'recordSellDecision must not recompute a band/fair_value for the sell decision').not.toMatch(/computeFairValue|recomputeIv|sustainableGrowthBand|twoStageValuation/i)
  })

  it('STRUCTURAL (d) never auto-close: recordSellDecision + the route never close a holding', () => {
    const slice = recordSellDecisionSlice(webWorkflowSrc)
    expect(slice, 'recordSellDecision must never emit holding_closed').not.toContain('holding_closed')
    expect(slice, 'recordSellDecision must never call closeHolding').not.toMatch(/closeHolding\(/)
    expect(routeSrc, 'the route must never emit holding_closed').not.toContain('holding_closed')
    expect(routeSrc, 'the route must never call closeHolding').not.toMatch(/closeHolding\(/)
  })
})
