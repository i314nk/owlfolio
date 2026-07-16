import { describe, expect, it, vi } from 'vitest'
import { runInversionPass, buildInversionLayer, type InversionResult } from '../inversionPass'
import type { GroundFn } from '../researchSwarm'

// E1 (owner call, 2026-07-12): the INVERSION PASS replaces the two-call red team. One focused
// grounded call argues the case AGAINST itself (Munger) + states the consensus view; cite-checked;
// NO answer-or-downgrade obligation machinery — the payload records it, the human audits it.

function inversionProvider(payload: unknown) {
  return {
    provider_id: 'fake-inversion',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => payload),
  }
}

const verifyAllGround: GroundFn = (async (sources: { source_id: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
    availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
  })),
  verified_ids: sources.map((s) => s.source_id),
})) as unknown as GroundFn

const baseArgs = {
  research_case_id: 'rc_inv',
  ticker: 'TST',
  model_id: 'mock',
  laneDigest: [
    { lane: 'moat', finding_summary: 'wide moat', confidence: 'high' },
    { lane: 'understand', finding_summary: 'clear model', confidence: 'medium' },
  ],
  caseDigest: { moat_class: 'wide', runway: 'proven', credited_growth_rate: 0.03, incremental_roic: 0.2 },
  corpusSourceIds: ['src_a', 'src_b'],
  verifiedCitationHashes: new Set(['src_a', 'src_b']),
}

function validInversionPayload() {
  return {
    strongest_case_against: 'The moat is thinner than the lanes claim.',
    moat_decay_scenario: 'A funded entrant erodes share over 5 years.',
    growth_credit_attack: 'Incremental ROIC will mean-revert below 10%.',
    shared_narrative_blindspots: ['All lanes read the same 10-K and missed segment concentration.'],
    strongest_objection: { claim: 'Customer concentration is a single point of failure.', severity: 'high', citations: ['src_a'] },
    consensus_check: {
      consensus_view: 'The street sees a fully-priced quality compounder.',
      thesis_vs_consensus: 'variant',
      variant_justification: 'The thesis weighs unit economics the consensus ignores.',
      citations: ['src_b'],
    },
    proposed_sources: [{ source_id: 'src_a', title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/a.htm', excerpt: 'e' }],
  }
}

describe('runInversionPass', () => {
  it('validates the schema and cite-checks the strongest objection + consensus against the corpus', async () => {
    const provider = inversionProvider(validInversionPayload())
    const result = await runInversionPass(provider as never, baseArgs, { ground: verifyAllGround })
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return
    expect(result.strongest_objection.citations).toEqual(['src_a'])
    expect(result.strongest_objection.severity).toBe('high')
    expect(result.strongest_case_against).toMatch(/thinner/)
    expect(result.consensus_check?.grounded).toBe(true)
    expect(result.uncited_objection_refs).toBeUndefined()
  })

  it('drops objection citations not in the verified corpus (no fabricated objections)', async () => {
    const payload = validInversionPayload()
    payload.strongest_objection.citations = ['src_a', 'src_fabricated']
    const provider = inversionProvider(payload)
    const result = await runInversionPass(provider as never, baseArgs, { ground: verifyAllGround })
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return
    expect(result.strongest_objection.citations).toEqual(['src_a'])
    expect(result.uncited_objection_refs).toEqual(['src_fabricated'])
  })

  it('an uncited consensus check survives as ungrounded (carries no lattice weight)', async () => {
    const payload = validInversionPayload()
    payload.consensus_check.citations = []
    const provider = inversionProvider(payload)
    const result = await runInversionPass(provider as never, baseArgs, { ground: verifyAllGround })
    if (result.status !== 'complete') throw new Error('should complete')
    expect(result.consensus_check?.grounded).toBe(false)
  })

  it('degrades to inversion_incomplete on timeout/failure (does NOT throw)', async () => {
    const provider = {
      provider_id: 'fake-inversion-fail', capabilities: {} as never,
      complete: vi.fn(), runWithTools: vi.fn(),
      structured: vi.fn(async () => { throw new Error('provider timed out') }),
    }
    const result = await runInversionPass(provider as never, baseArgs, { ground: verifyAllGround })
    expect(result.status).toBe('inversion_incomplete')
    if (result.status !== 'inversion_incomplete') return
    expect(result.reason).toMatch(/timed out/i)
    expect(provider.structured).toHaveBeenCalledTimes(2)
  })
})

describe('inversion prompt calibration (live find: prose cited instead of source_ids)', () => {
  it('the prompt steers citations to be corpus source_ids verbatim, never quoted prose', async () => {
    const calls: string[] = []
    const provider = {
      provider_id: 'fake-prompt-probe',
      capabilities: {} as never,
      complete: async () => { throw new Error('unused') },
      runWithTools: async () => { throw new Error('unused') },
      structured: async (req: { prompt: string }) => {
        calls.push(req.prompt)
        return validInversionPayload()
      },
    }
    await runInversionPass(provider as never, baseArgs, { ground: verifyAllGround })
    const prompt = calls[0] ?? ''
    expect(prompt).toContain('CITATION FORMAT')
    expect(prompt).toContain('VERBATIM')
    expect(prompt).toContain('are NOT citations')
    expect(prompt).toContain('put ONLY the source_id in citations')
  })
})

describe('buildInversionLayer — no obligation machinery', () => {
  const completeInversion: InversionResult = {
    status: 'complete',
    strongest_case_against: 'bear',
    moat_decay_scenario: 'decay',
    growth_credit_attack: 'attack',
    shared_narrative_blindspots: [],
    strongest_objection: { claim: 'Customer concentration risk', severity: 'high', citations: ['src_a'] },
  }

  it('carries the case-against narrative + the objection verbatim; no unaddressed/response fields exist', () => {
    const { layer, openQuestion } = buildInversionLayer({ inversion: completeInversion })
    expect(layer.status).toBe('complete')
    expect(layer.strongest_objection?.claim).toBe('Customer concentration risk')
    expect('objection_unaddressed' in layer).toBe(false)
    expect('synthesis_response' in layer).toBe(false)
    expect(openQuestion).toBeUndefined()
  })

  it('an incomplete pass records the degraded state + ONE honesty open question', () => {
    const { layer, openQuestion } = buildInversionLayer({ inversion: { status: 'inversion_incomplete', reason: 'timeout' } })
    expect(layer.status).toBe('inversion_incomplete')
    expect(openQuestion).toMatch(/inversion_incomplete/)
    expect(openQuestion).toMatch(/argued against itself/)
  })
})
