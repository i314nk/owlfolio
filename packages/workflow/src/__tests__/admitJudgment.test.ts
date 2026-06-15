import { describe, expect, it, vi } from 'vitest'
import {
  classifyAdmit,
  runAdmitJudgment,
  AdmitJudgmentSchema,
  buildAdmitBearPrompt,
  type RunAdmitJudgmentArgs,
} from '../admitJudgment'
import type { GroundFn } from '../groundedAgent'

// ---------------------------------------------------------------------------
// Part A — classifyAdmit: the PURE deterministic forcing function (THE GATE).
// The two poles MUST come from the SAME function with OPPOSITE results — that is the
// proof of discrimination (an eroder-only test is only half a test).
// ---------------------------------------------------------------------------

describe('classifyAdmit — the deterministic forcing gate', () => {
  it('PAIRED POLES (discrimination): eroder → permanent_impairment/not-admittable AND stumble → fixable_temporary/admittable', () => {
    // Eroder pole: a name that PASSES quality but is terminally impaired must NOT be a clean admit.
    const eroder = classifyAdmit({ uncertainty: 'medium', permanent_loss_risk: 'high', quality_verdict_passes: true })
    expect(eroder.impairment_call).toBe('permanent_impairment')
    expect(eroder.admittable).toBe(false)

    // Temporary-stumble pole: high uncertainty + low permanent-loss = the opportunity; admittable.
    const stumble = classifyAdmit({ uncertainty: 'high', permanent_loss_risk: 'low', quality_verdict_passes: true })
    expect(stumble.impairment_call).toBe('fixable_temporary')
    expect(stumble.admittable).toBe(true)

    // The two opposite results come from the SAME function — discrimination proven.
    expect(eroder.impairment_call).not.toBe(stumble.impairment_call)
    expect(eroder.admittable).not.toBe(stumble.admittable)
  })

  it('ANTI-HOLLOW: high permanent_loss_risk overrides quality_verdict_passes=true', () => {
    const r = classifyAdmit({ uncertainty: 'low', permanent_loss_risk: 'high', quality_verdict_passes: true })
    expect(r.impairment_call).toBe('permanent_impairment')
    expect(r.admittable).toBe(false)
    expect(r.reason).toMatch(/permanent.loss.risk/i)
  })

  it('uncertainty does NOT block admit — only permanent-loss risk does (high uncertainty is the opportunity)', () => {
    const r = classifyAdmit({ uncertainty: 'high', permanent_loss_risk: 'low', quality_verdict_passes: true })
    expect(r.admittable).toBe(true)
    expect(r.impairment_call).toBe('fixable_temporary')
  })

  it('medium permanent_loss_risk → unresolved / not-admittable (do not admit on a maybe)', () => {
    const r = classifyAdmit({ uncertainty: 'low', permanent_loss_risk: 'medium', quality_verdict_passes: true })
    expect(r.impairment_call).toBe('unresolved')
    expect(r.admittable).toBe(false)
    expect(r.reason).toMatch(/unresolved|medium/i)
  })

  it('quality_verdict_passes=false → not admittable regardless of risk levels', () => {
    const lowRisk = classifyAdmit({ uncertainty: 'low', permanent_loss_risk: 'low', quality_verdict_passes: false })
    expect(lowRisk.admittable).toBe(false)
    expect(lowRisk.reason).toMatch(/quality/i)

    // Even low/low cheapness on a non-wonderful business is not the signal.
    const stumbleShaped = classifyAdmit({ uncertainty: 'high', permanent_loss_risk: 'low', quality_verdict_passes: false })
    expect(stumbleShaped.admittable).toBe(false)
  })

  it('is pure/deterministic: same args yield identical results', () => {
    const a = classifyAdmit({ uncertainty: 'high', permanent_loss_risk: 'low', quality_verdict_passes: true })
    const b = classifyAdmit({ uncertainty: 'high', permanent_loss_risk: 'low', quality_verdict_passes: true })
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// Part B — runAdmitJudgment: the provider-driven step that FEEDS the classifier.
// ---------------------------------------------------------------------------

function admitProvider(payload: unknown) {
  return {
    provider_id: 'fake-admit',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => payload),
  }
}

/** The recorded args of a single provider.structured call (the request prompt is what we inspect). */
type RecordedCall = { prompt: string }

/**
 * A fake provider that records the request of EACH structured call and returns a per-call payload.
 * The layer now makes TWO calls — Step 1 (independent bear case) then Step 2 (the judgment) — so the
 * test inspects the ACTUAL arguments each call received (code path), not a prompt builder in isolation.
 */
function recordingAdmitProvider(payloads: unknown[]) {
  const calls: RecordedCall[] = []
  let i = 0
  return {
    provider: {
      provider_id: 'fake-admit-recording',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async (req: { prompt: string }) => {
        calls.push({ prompt: req.prompt })
        const payload = payloads[Math.min(i, payloads.length - 1)]
        i += 1
        return payload
      }),
    },
    calls,
  }
}

/** Step-1 payload: an INDEPENDENT impairment bear case (only the bear case + sources). */
function bearCasePayload() {
  return {
    impairment_bear_case:
      'From the filings cold: the renewal cohort and deferred revenue are eroding structurally; this is terminal, not a stumble.',
    proposed_sources: proposedSources(),
  }
}

const verifyAllGround: GroundFn = (async (sources: { source_id: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
    availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
  })),
  verified_ids: sources.map((s) => s.source_id),
})) as unknown as GroundFn

const baseArgs: RunAdmitJudgmentArgs = {
  research_case_id: 'rc_admit',
  ticker: 'TST',
  model_id: 'mock',
  quality_verdict_passes: true,
  laneDigest: [
    { lane: 'moat', finding_summary: 'wide moat', confidence: 'high' },
    { lane: 'risks', finding_summary: 'cyclical drawdown', confidence: 'medium' },
  ],
  cheapness_summary: 'OE-yield 9% on a gate-passing business; price down 60% on a guidance cut.',
  corpusSourceIds: ['src_a', 'src_b'],
  verifiedCitationHashes: new Set(['src_a', 'src_b']),
  valuation: { buy_below: 42 },
}

function proposedSources() {
  return [{ source_id: 'src_a', title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/a.htm', excerpt: 'e' }]
}

function stumbleShapedPayload() {
  return {
    uncertainty: {
      level: 'high',
      argument: 'Demand timing is genuinely unknowable for 12-18 months.',
      citations: ['src_a'],
    },
    permanent_loss_risk: {
      level: 'low',
      argument: 'Non-recourse debt + liquidation value well above the current price floor the downside.',
      citations: ['src_b'],
    },
    impairment_bear_case: 'Argue impairment from filings: even so, the asset base and balance sheet survive a prolonged trough.',
    proposed_sources: proposedSources(),
  }
}

function eroderShapedPayload() {
  return {
    uncertainty: {
      level: 'medium',
      argument: 'The decline is well understood, not ambiguous.',
      citations: ['src_a'],
    },
    permanent_loss_risk: {
      level: 'high',
      argument: 'The product category is being structurally displaced; revenue base is permanently shrinking.',
      citations: ['src_b'],
    },
    impairment_bear_case: 'From the filings: deferred revenue and renewal rates are collapsing — the cheapness is terminal, not temporary.',
    proposed_sources: proposedSources(),
  }
}

describe('runAdmitJudgment — provider-driven judgment feeding the classifier', () => {
  it('stumble-shaped fixture (low permanent-loss, high uncertainty) → fixable_temporary / admittable', async () => {
    const provider = admitProvider(stumbleShapedPayload())
    const rec = await runAdmitJudgment(provider as never, baseArgs, { ground: verifyAllGround })
    expect(rec.status).toBe('complete')
    if (rec.status !== 'complete') return
    expect(rec.impairment_call).toBe('fixable_temporary')
    expect(rec.admittable).toBe(true)
    expect(rec.uncertainty.level).toBe('high')
    expect(rec.permanent_loss_risk.level).toBe('low')
    expect(rec.permanent_loss_risk.citations).toEqual(['src_b'])
    expect(rec.buy_below).toBe(42)
  })

  it('eroder-shaped fixture (high permanent-loss) → permanent_impairment / NOT admittable, even though quality passes', async () => {
    const provider = admitProvider(eroderShapedPayload())
    const rec = await runAdmitJudgment(provider as never, { ...baseArgs, quality_verdict_passes: true }, { ground: verifyAllGround })
    expect(rec.status).toBe('complete')
    if (rec.status !== 'complete') return
    expect(rec.impairment_call).toBe('permanent_impairment')
    expect(rec.admittable).toBe(false)
    expect(rec.permanent_loss_risk.level).toBe('high')
  })

  it('SCHEMA FORCES separate grounded fields: rejects a fixture missing permanent_loss_risk entirely', () => {
    const bad = stumbleShapedPayload() as Record<string, unknown>
    delete bad['permanent_loss_risk']
    expect(() => AdmitJudgmentSchema.parse(bad)).toThrow()
  })

  it('SCHEMA FORCES citations: rejects a fixture whose permanent_loss_risk has no citations', () => {
    const bad = stumbleShapedPayload()
    bad.permanent_loss_risk.citations = []
    expect(() => AdmitJudgmentSchema.parse(bad)).toThrow()
  })

  it('SCHEMA FORCES citations: rejects a fixture whose uncertainty has no citations', () => {
    const bad = stumbleShapedPayload()
    bad.uncertainty.citations = []
    expect(() => AdmitJudgmentSchema.parse(bad)).toThrow()
  })

  it('the bear case is the INDEPENDENT impairment-from-filings framing, NOT critique-the-bull-thesis', () => {
    const prompt = buildAdmitBearPrompt(baseArgs)
    // Argues permanent impairment FROM THE FILINGS cold.
    expect(prompt).toMatch(/permanent/i)
    expect(prompt).toMatch(/impair/i)
    expect(prompt).toMatch(/filings/i)
    // Routed specifically at the permanent_loss_risk claim.
    expect(prompt).toMatch(/permanent.loss.risk/i)
    // It explicitly DISCLAIMS the critique-the-thesis framing: the agent is NOT handed a bull/admit
    // thesis to poke holes in (the load-bearing difference from redTeamPass, which critiques the digest).
    expect(prompt).toMatch(/do not critique a bull thesis/i)
    expect(prompt).toMatch(/you are not given one/i)
    expect(prompt).toMatch(/from the filings cold/i)
  })

  // -------------------------------------------------------------------------
  // INDEPENDENCE IN THE CODE PATH (not the prompt string). The layer makes TWO calls; we inspect the
  // ACTUAL arguments each provider call received. The bear case must be generated from the filings
  // COLD — its call must NOT see the bull/quality narrative (the value trap hides in that gap).
  // -------------------------------------------------------------------------

  it('CODE PATH: the bear-case call actually happens (buildAdmitBearPrompt is on the path, not dead code)', async () => {
    const { provider, calls } = recordingAdmitProvider([bearCasePayload(), stumbleShapedPayload()])
    const rec = await runAdmitJudgment(provider as never, baseArgs, { ground: verifyAllGround })
    expect(rec.status).toBe('complete')
    // Two calls: Step 1 independent bear case, Step 2 the judgment.
    expect(calls.length).toBe(2)
    // The first call IS the independent bear-case prompt produced by buildAdmitBearPrompt.
    expect(calls[0]!.prompt).toBe(buildAdmitBearPrompt(baseArgs))
  })

  it('INDEPENDENCE: the bear-case call context contains ONLY corpus/cheapness — NOT quality_verdict/laneDigest/bull-thesis', async () => {
    const { provider, calls } = recordingAdmitProvider([bearCasePayload(), stumbleShapedPayload()])
    await runAdmitJudgment(provider as never, baseArgs, { ground: verifyAllGround })
    const bearPrompt = calls[0]!.prompt
    // It DOES carry the corpus it must cite (grounding) — that is allowed cold context.
    expect(bearPrompt).toContain('src_a')
    expect(bearPrompt).toContain('src_b')
    // It must NOT carry the bull/quality narrative that turns it into critique-the-thesis:
    //   - the quality verdict rendered into the prompt ("PASSED ... on quality")
    expect(bearPrompt).not.toMatch(/on quality/i)
    expect(bearPrompt).not.toMatch(/PASSED/)
    //   - the lane-digest findings (the bull case the swarm built)
    expect(bearPrompt).not.toContain('wide moat')
    expect(bearPrompt).not.toContain('cyclical drawdown')
    expect(bearPrompt).not.toMatch(/lane findings/i)
    //   - an admit/bull thesis to poke holes in
    expect(bearPrompt).not.toMatch(/bull thesis to/i)
  })

  it('STEP 2: the judgment call RECEIVES the independent bear case from Step 1 as input', async () => {
    const bear = bearCasePayload()
    const { provider, calls } = recordingAdmitProvider([bear, stumbleShapedPayload()])
    await runAdmitJudgment(provider as never, baseArgs, { ground: verifyAllGround })
    const judgmentPrompt = calls[1]!.prompt
    // The judgment (Step 2) is fed the independent bear case so permanent_loss_risk is pressure-tested.
    expect(judgmentPrompt).toContain(bear.impairment_bear_case)
  })

  it('RESULT: impairment_bear_case is the Step-1 independent bear case, not a field the judgment call emitted', async () => {
    const bear = bearCasePayload()
    const { provider } = recordingAdmitProvider([bear, stumbleShapedPayload()])
    const rec = await runAdmitJudgment(provider as never, baseArgs, { ground: verifyAllGround })
    expect(rec.status).toBe('complete')
    if (rec.status !== 'complete') return
    expect(rec.impairment_bear_case).toBe(bear.impairment_bear_case)
  })

  it('FAIL-CLOSED: if the bear-case call fails, the judgment degrades visibly (admit_judgment_incomplete), no clean admit', async () => {
    const provider = {
      provider_id: 'fake-admit-bear-fails',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      // The FIRST (bear-case) call throws on every attempt; the layer must not silently proceed.
      structured: vi.fn(async () => {
        throw new Error('bear-case provider timeout')
      }),
    }
    const rec = await runAdmitJudgment(provider as never, baseArgs, { ground: verifyAllGround })
    expect(rec.status).toBe('admit_judgment_incomplete')
    if (rec.status !== 'admit_judgment_incomplete') return
    // It does NOT fabricate a clean admit or proceed with no bear case.
    expect(rec).not.toHaveProperty('admittable')
    expect(rec).not.toHaveProperty('impairment_bear_case')
  })

  it('NO AUTO-ADMIT: the output is a recommendation only; admittable is a recommendation flag', async () => {
    const provider = admitProvider(stumbleShapedPayload())
    const rec = await runAdmitJudgment(provider as never, baseArgs, { ground: verifyAllGround })
    expect(rec.status).toBe('complete')
    if (rec.status !== 'complete') return
    // It is a RECOMMENDATION surfaced to the human — no transition/event field.
    expect(rec).not.toHaveProperty('transitioned')
    expect(rec).not.toHaveProperty('watched')
    expect(rec).not.toHaveProperty('event_id')
  })
})
