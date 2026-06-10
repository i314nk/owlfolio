import { describe, expect, it, vi } from 'vitest'
import { runRedTeamPass, buildRedTeamLayer, type RedTeamResult, type SynthesisResponse } from '../redTeamPass'
import type { GroundFn } from '../researchSwarm'

function redTeamProvider(payload: unknown) {
  return {
    provider_id: 'fake-red-team',
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
  research_case_id: 'rc_rt',
  ticker: 'TST',
  model_id: 'mock',
  laneDigest: [
    { lane: 'moat', finding_summary: 'wide moat', confidence: 'high' },
    { lane: 'risks', finding_summary: 'some risks', confidence: 'medium' },
  ],
  caseDigest: { moat_class: 'wide', runway: 'proven', credited_growth_rate: 0.03, incremental_roic: 0.2 },
  corpusSourceIds: ['src_a', 'src_b'],
  verifiedCitationHashes: new Set(['src_a', 'src_b']),
}

function validRedTeamPayload() {
  return {
    strongest_bear_case: 'The moat is thinner than the lanes claim.',
    weakest_rubric_items: [{ lane: 'moat', item: 'M5', why: 'switching evidence is thin' }],
    moat_decay_scenario: 'A funded entrant erodes share over 5 years.',
    growth_credit_attack: 'Incremental ROIC will mean-revert below 10%.',
    shared_narrative_blindspots: ['All lanes read the same 10-K and missed segment concentration.'],
    strongest_objection: { claim: 'Customer concentration is a single point of failure.', severity: 'high', citations: ['src_a'] },
    proposed_sources: [{ source_id: 'src_a', title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/a.htm', excerpt: 'e' }],
  }
}

describe('runRedTeamPass', () => {
  it('validates the schema and cite-checks the strongest objection against the corpus', async () => {
    const provider = redTeamProvider(validRedTeamPayload())
    const result = await runRedTeamPass(provider as never, baseArgs, { ground: verifyAllGround })
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return
    expect(result.strongest_objection.citations).toEqual(['src_a'])
    expect(result.strongest_objection.severity).toBe('high')
    expect(result.weakest_rubric_items[0]?.item).toBe('M5')
    expect(result.uncited_objection_refs).toBeUndefined()
  })

  it('drops objection citations not in the verified corpus (no fabricated objections)', async () => {
    const payload = validRedTeamPayload()
    payload.strongest_objection.citations = ['src_a', 'src_fabricated']
    const provider = redTeamProvider(payload)
    const result = await runRedTeamPass(provider as never, baseArgs, { ground: verifyAllGround })
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return
    // Only the verified citation survives; the fabricated one is recorded separately, never hidden.
    expect(result.strongest_objection.citations).toEqual(['src_a'])
    expect(result.uncited_objection_refs).toEqual(['src_fabricated'])
  })

  it('degrades to red_team_incomplete on timeout/failure (does NOT throw)', async () => {
    const provider = {
      provider_id: 'fake-red-team-fail', capabilities: {} as never,
      complete: vi.fn(), runWithTools: vi.fn(),
      structured: vi.fn(async () => { throw new Error('Codex CLI timed out') }),
    }
    const result = await runRedTeamPass(provider as never, baseArgs, { ground: verifyAllGround })
    expect(result.status).toBe('red_team_incomplete')
    if (result.status !== 'red_team_incomplete') return
    expect(result.reason).toMatch(/timed out/i)
    // It retries once (runGroundedAgentWithRetry default) → exactly 2 attempts before degrading.
    expect(provider.structured).toHaveBeenCalledTimes(2)
  })
})

describe('buildRedTeamLayer — synthesis obligation enforcement', () => {
  const completeRedTeam: RedTeamResult = {
    status: 'complete',
    strongest_bear_case: 'bear',
    weakest_rubric_items: [],
    moat_decay_scenario: 'decay',
    growth_credit_attack: 'attack',
    shared_narrative_blindspots: [],
    strongest_objection: { claim: 'Customer concentration risk', severity: 'high', citations: ['src_a'] },
  }

  it('no flag when synthesis answers the objection with evidence', () => {
    const response: SynthesisResponse = { mode: 'answered_with_evidence', text: 'Top customer is <10% of revenue per the 10-K.' }
    const { layer, openQuestion } = buildRedTeamLayer({ redTeam: completeRedTeam, synthesisResponse: response })
    expect(layer.objection_unaddressed).toBeUndefined()
    expect(layer.synthesis_response?.mode).toBe('answered_with_evidence')
    expect(openQuestion).toBeUndefined()
  })

  it('flags red_team_objection_unaddressed + open question when synthesis is silent', () => {
    const { layer, openQuestion } = buildRedTeamLayer({ redTeam: completeRedTeam, synthesisResponse: undefined })
    expect(layer.objection_unaddressed).toBe(true)
    expect(openQuestion).toMatch(/red_team_objection_unaddressed/)
    expect(layer.synthesis_response).toBeUndefined()
  })

  it('flags unaddressed when synthesis response is present but empty', () => {
    const { layer } = buildRedTeamLayer({
      redTeam: completeRedTeam,
      synthesisResponse: { mode: 'answered_with_evidence', text: '   ' },
    })
    expect(layer.objection_unaddressed).toBe(true)
  })

  it('records the downgrade when mode === accepted_downgraded', () => {
    const response: SynthesisResponse = {
      mode: 'accepted_downgraded',
      text: 'Accepted: concentration risk justifies a tier cut.',
      downgrade: { dimension: 'tier', from: 'wide', to: 'moderate' },
    }
    const { layer, openQuestion } = buildRedTeamLayer({ redTeam: completeRedTeam, synthesisResponse: response })
    expect(layer.objection_unaddressed).toBeUndefined()
    expect(layer.synthesis_response?.mode).toBe('accepted_downgraded')
    expect(layer.synthesis_response?.downgrade?.to).toBe('moderate')
    expect(openQuestion).toBeUndefined()
  })

  it('records degraded state (no objection to address) when the red team is incomplete', () => {
    const { layer, openQuestion } = buildRedTeamLayer({
      redTeam: { status: 'red_team_incomplete', reason: 'timeout' },
      synthesisResponse: undefined,
    })
    expect(layer.status).toBe('red_team_incomplete')
    expect(layer.objection_unaddressed).toBeUndefined()
    expect(openQuestion).toMatch(/red_team_incomplete/)
  })

  it('does NOT require a response for an objection with no surviving citation (fully fabricated)', () => {
    const noCite: RedTeamResult = {
      ...completeRedTeam,
      strongest_objection: { claim: 'uncited', severity: 'low', citations: [] },
      uncited_objection_refs: ['src_fake'],
    }
    const { layer } = buildRedTeamLayer({ redTeam: noCite, synthesisResponse: undefined })
    expect(layer.objection_unaddressed).toBeUndefined()
  })
})
