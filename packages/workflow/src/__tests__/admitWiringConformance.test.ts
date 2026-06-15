import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------------------------------
// Task 4.2c — WIRING-CONFORMANCE TRIPWIRE (the "built-but-unwired" guard).
//
// Same leverage as the Part-D conformance test: SOURCE-LEVEL assertions (a grep over the COMMITTED
// non-test source) that the admission-critical functions are REACHABLE from a LIVE path, not pure
// islands. Before 4.2c, screenCheapness + runAdmitJudgment were built + tested but NEVER called from a
// live (non-test) path — these assertions would have FAILED. They pass after the orchestrator + route
// wire them in. If a future edit makes them islands again (the orchestrator stops calling them, or the
// route stops calling the orchestrator), this trips.
// ---------------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const workflowSrc = join(here, '..')
const repoRoot = join(workflowSrc, '..', '..', '..')

const orchestratorSrc = readFileSync(join(workflowSrc, 'admitAssessment.ts'), 'utf8')
const routeSrc = readFileSync(
  join(repoRoot, 'apps', 'web', 'src', 'app', 'api', 'research', '[caseId]', 'admit-judgment', 'route.ts'),
  'utf8',
)
const webWorkflowSrc = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'workflow.ts'), 'utf8')
const researchStartRouteSrc = readFileSync(
  join(repoRoot, 'apps', 'web', 'src', 'app', 'api', 'research', 'start', 'route.ts'),
  'utf8',
)

describe('Task 4.2c wiring conformance: admit judgment + cheapness are reachable from a LIVE path', () => {
  it('the orchestrator calls BOTH screenCheapness AND runAdmitJudgment (not islands)', () => {
    // Would have FAILED pre-4.2c: there was no orchestrator calling these two functions.
    expect(orchestratorSrc).toMatch(/runAdmitJudgment\s*\(/)
    expect(orchestratorSrc).toMatch(/screenCheapness\s*\(/)
  })

  it('the on-demand route + web workflow invoke the orchestrator (runAdmitAssessment) on a live path', () => {
    // The route delegates to the web workflow, which calls the orchestrator. Both halves of the wiring
    // are asserted so a break on either side (route → workflow, or workflow → orchestrator) trips.
    expect(routeSrc).toMatch(/recordAdmitJudgment\s*\(/)
    expect(webWorkflowSrc).toMatch(/runAdmitAssessment\s*\(/)
  })

  it('the route emits the admit_judgment_recorded OBSERVATION via the web workflow', () => {
    // The persisted artifact is emitted from the live path — not test-only scaffolding.
    expect(webWorkflowSrc).toContain('admit_judgment_recorded')
  })

  it('inCircle stays wired into the research-start route (the existing pre-spend gate)', () => {
    // The circle-of-competence check is reached from /api/research/start via evaluateCircleGate, which
    // is the function that calls inCircle. Guard that the start route still consults the circle gate.
    expect(researchStartRouteSrc).toMatch(/evaluateCircleGate\s*\(/)
  })

  it('inCircle is actually called by the circle gate the start route consults', () => {
    const circleGateSrc = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'circleGate.ts'), 'utf8')
    expect(circleGateSrc).toMatch(/inCircle\s*\(/)
  })
})
