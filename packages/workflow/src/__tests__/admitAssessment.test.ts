import { describe, expect, it, vi } from 'vitest'

import { runAdmitAssessment, type RunAdmitAssessmentArgs } from '../admitAssessment'
import type { AnnualFacts, Fundamentals } from '../secEdgar'
import type { GroundFn } from '../groundedAgent'

// ---------------------------------------------------------------------------
// Task 4.2c — the ADMIT ASSESSMENT ORCHESTRATOR. Composes screenCheapness (Phase-1 OE / EV) +
// runAdmitJudgment (the independent impairment bear case + the two grounded risk fields → classifyAdmit)
// into one on-demand assessment for a deep-dive-complete, GATE-PASSING research case.
//
// The orchestrator is the LIVE path that wires the two built-but-unwired islands together; these tests
// exercise it with a FAKE provider (fixture structured outputs, same style as the swarm/red-team tests).
// ---------------------------------------------------------------------------

function makeFundamentals(overrides?: Partial<AnnualFacts>): Fundamentals {
  const latest: AnnualFacts = {
    fiscal_year: 2024,
    currency: 'USD',
    net_income_musd: 1000, cfo_musd: 1300,
    d_and_a_musd: 200,
    capex_musd: 300,
    sbc_musd: 150,
    diluted_shares_m: 100,
    total_debt_musd: 500,
    cash_and_securities_musd: 200,
    ...overrides,
  }
  return {
    cik: '0000000001',
    entity_name: 'Test Co',
    currency: 'USD',
    latest_annual: latest,
    annual_series: [latest],
    filings: [],
  }
}

const verifyAllGround: GroundFn = (async (sources: { source_id: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
    availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
  })),
  verified_ids: sources.map((s) => s.source_id),
})) as unknown as GroundFn

function proposedSources() {
  return [{ source_id: 'src_a', title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/a.htm', excerpt: 'e' }]
}

function bearCasePayload() {
  return {
    impairment_bear_case: 'From the filings cold: the discount reflects a smaller intrinsic value; renewal cohorts are eroding.',
    proposed_sources: proposedSources(),
  }
}

function stumblePayload() {
  return {
    uncertainty: { level: 'high', argument: 'Demand timing unknowable.', citations: ['src_a'] },
    permanent_loss_risk: { level: 'low', argument: 'Non-recourse debt + liquidation value floor the downside.', citations: ['src_b'] },
    proposed_sources: proposedSources(),
  }
}

function eroderPayload() {
  return {
    uncertainty: { level: 'medium', argument: 'The decline is well understood.', citations: ['src_a'] },
    permanent_loss_risk: { level: 'high', argument: 'The category is structurally displaced.', citations: ['src_b'] },
    proposed_sources: proposedSources(),
  }
}

/** A fake provider that returns the Step-1 (bear) then Step-2 (judgment) payloads in order. */
function admitProvider(payloads: unknown[]) {
  let i = 0
  return {
    provider_id: 'fake-admit',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => {
      const payload = payloads[Math.min(i, payloads.length - 1)]
      i += 1
      return payload
    }),
  }
}

const baseArgs = (): RunAdmitAssessmentArgs => ({
  research_case_id: 'rc_assess',
  ticker: 'TST',
  model_id: 'mock',
  stage: 'deep_dive_completed',
  gate_passing: true,
  fundamentals: makeFundamentals(),
  market_cap_musd: 10_000,
  laneDigest: [{ lane: 'moat', finding_summary: 'wide moat', confidence: 'high' }],
  corpusSourceIds: ['src_a', 'src_b'],
  verifiedCitationHashes: new Set(['src_a', 'src_b']),
  valuation: { buy_below: 42 },
})

describe('runAdmitAssessment — the on-demand orchestrator', () => {
  it('composes cheapness + admit judgment for a gate-passing deep-dive-complete case (stumble → admittable)', async () => {
    const provider = admitProvider([bearCasePayload(), stumblePayload()])
    const out = await runAdmitAssessment(provider as never, baseArgs(), { ground: verifyAllGround })
    expect(out.status).toBe('complete')
    if (out.status !== 'complete') return

    // The cheapness summary is present (Phase-1 OE / EV — the screen's reader output).
    expect(out.recommendation.cheapness).toBeDefined()
    expect(out.recommendation.cheapness?.fcf_yield).toBeGreaterThan(0)
    expect(out.recommendation.cheapness?.ev).toBe(10_300)

    // admittable / impairment_call come from classifyAdmit (NOT the model).
    expect(out.recommendation.impairment_call).toBe('fixable_temporary')
    expect(out.recommendation.admittable).toBe(true)
    expect(out.recommendation.buy_below).toBe(42)
    expect(out.recommendation.impairment_bear_case).toContain('From the filings cold')
  })

  it('eroder fixture (high permanent-loss) → permanent_impairment / NOT admittable even though gate passes', async () => {
    const provider = admitProvider([bearCasePayload(), eroderPayload()])
    const out = await runAdmitAssessment(provider as never, baseArgs(), { ground: verifyAllGround })
    expect(out.status).toBe('complete')
    if (out.status !== 'complete') return
    expect(out.recommendation.impairment_call).toBe('permanent_impairment')
    expect(out.recommendation.admittable).toBe(false)
  })

  it('REJECTS a non-gate-passing case (the admit question is only live for an admission candidate)', async () => {
    const provider = admitProvider([bearCasePayload(), stumblePayload()])
    const out = await runAdmitAssessment(provider as never, { ...baseArgs(), gate_passing: false }, { ground: verifyAllGround })
    expect(out.status).toBe('not_an_admission_candidate')
    if (out.status !== 'not_an_admission_candidate') return
    expect(out.reason).toMatch(/gate/i)
    // The provider was never called — no judgment is computed for a non-candidate.
    expect((provider.structured as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('REJECTS a case that is not deep-dive-complete (no admit judgment before the deep dive finishes)', async () => {
    const provider = admitProvider([bearCasePayload(), stumblePayload()])
    const out = await runAdmitAssessment(provider as never, { ...baseArgs(), stage: 'deep_dive_started' }, { ground: verifyAllGround })
    expect(out.status).toBe('not_an_admission_candidate')
    if (out.status !== 'not_an_admission_candidate') return
    expect(out.reason).toMatch(/deep.dive/i)
    expect((provider.structured as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('Phase 5 S2: a LOW permanent-loss stumble + positive net cash → a sound net-cash downside floor rides on the recommendation', async () => {
    const provider = admitProvider([bearCasePayload(), stumblePayload()])
    // Positive net cash: cash 600 − debt 100 = 500 / 100 shares = 5.0/share.
    const args = { ...baseArgs(), fundamentals: makeFundamentals({ cash_and_securities_musd: 600, total_debt_musd: 100, stockholders_equity_musd: 800 }) }
    const out = await runAdmitAssessment(provider as never, args, { ground: verifyAllGround })
    expect(out.status).toBe('complete')
    if (out.status !== 'complete') return
    const floor = out.recommendation.downside_floor
    expect(floor?.status).toBe('floor')
    if (floor?.status !== 'floor') return
    expect(floor.floor_per_share).toBeCloseTo(5.0, 6)
    expect(floor.basis).toBe('net_cash') // the basis rides alongside — never flattened to a bare number
    expect(floor.reliability).toBe('sound') // gated by the LOW permanent-loss level
  })

  it('Phase 5 S2: the 4.2a level gates the floor — a HIGH permanent-loss eroder → cannot_floor even on a clean balance sheet', async () => {
    const provider = admitProvider([bearCasePayload(), eroderPayload()]) // eroder = permanent_loss_risk HIGH
    // A SUPERFICIALLY CLEAN balance sheet (positive net cash) — arithmetic alone would compute a healthy
    // floor — but the grounded HIGH level says the balance sheet is unreliable (Horsehead-style).
    const args = { ...baseArgs(), fundamentals: makeFundamentals({ cash_and_securities_musd: 600, total_debt_musd: 100, stockholders_equity_musd: 800 }) }
    const out = await runAdmitAssessment(provider as never, args, { ground: verifyAllGround })
    expect(out.status).toBe('complete')
    if (out.status !== 'complete') return
    expect(out.recommendation.downside_floor?.status).toBe('cannot_floor')
  })

  it('passes the cheapness screen summary into the judgment so "why cheap" frames the question', async () => {
    const provider = admitProvider([bearCasePayload(), stumblePayload()])
    await runAdmitAssessment(provider as never, baseArgs(), { ground: verifyAllGround })
    const judgmentPrompt = (provider.structured as ReturnType<typeof vi.fn>).mock.calls[1]![0].prompt as string
    // The Step-2 judgment prompt carries the cheapness framing (an OE-yield % rendered into the prompt).
    expect(judgmentPrompt).toMatch(/yield/i)
  })
})
