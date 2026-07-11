import { describe, expect, it } from 'vitest'
import { buildMungerLattice } from '../mungerLattice'

// ---------------------------------------------------------------------------------------------------
// S7 (Phase 3 pillars): the Munger mental-model LATTICE — a DETERMINISTIC harness assembly over
// artifacts that already exist. No model ever emits "I applied inversion"; the harness asserts a
// model was applied ONLY when its underlying artifact exists and survived its cite-check:
//   inversion         ← the red-team layer (bear case + forced synthesis response)
//   base rates        ← the base-rate burden flags
//   incentive analysis ← the S5 management comp_structure (grounded DEF 14A citation)
//   social proof      ← the red team's consensus_check (cite-checked)
// Anything absent/ungrounded is 'unavailable' WITH the reason — no checkbox theater.
// ---------------------------------------------------------------------------------------------------

const completeInversion = {
  status: 'complete' as const,
  strongest_objection: { claim: 'Growth credit is unsustainable', severity: 'high' as const, citations: ['src_1'] },
  consensus_check: {
    consensus_view: 'The street sees a durable compounder at a fair price.',
    thesis_vs_consensus: 'variant' as const,
    variant_justification: 'The thesis prices margin durability the street does not.',
    citations: ['src_1'],
    grounded: true,
  },
}

function fullArgs() {
  return {
    inversion: completeInversion,
    baseRateBurden: { flags: [{ claim: 'monopoly classification', status: 'met' }, { claim: 'g in 4-5% band', status: 'unmet' }] },
    managementJudgment: {
      resolved_integrity: 'clean' as const,
      resolved_talent: 'excellent' as const,
      integrity: {
        comp_structure: { summary: 'Bonus on ROIC + FCF/share.', alignment: 'aligned' as const, citation: 'src_def14a' },
        comp_grounded: true,
      },
    },
  }
}

describe('buildMungerLattice — deterministic assembly (no checkbox theater)', () => {
  it('marks all four models applied when every artifact exists and grounds', () => {
    const lattice = buildMungerLattice(fullArgs())
    expect(lattice.entries.map((e) => e.model)).toEqual(['inversion', 'base_rates', 'incentive_analysis', 'social_proof'])
    expect(lattice.entries.every((e) => e.status === 'applied')).toBe(true)
    const inversion = lattice.entries.find((e) => e.model === 'inversion')
    expect(inversion?.summary).toMatch(/Growth credit is unsustainable/)
    const baseRates = lattice.entries.find((e) => e.model === 'base_rates')
    expect(baseRates?.summary).toMatch(/1 unmet/)
    const social = lattice.entries.find((e) => e.model === 'social_proof')
    expect(social?.summary).toMatch(/variant/i)
  })

  it('inversion is unavailable (with the reason) when the inversion pass did not complete', () => {
    const lattice = buildMungerLattice({
      ...fullArgs(),
      inversion: { status: 'inversion_incomplete' as const, reason: 'timeout' },
    })
    const inversion = lattice.entries.find((e) => e.model === 'inversion')
    expect(inversion?.status).toBe('unavailable')
    expect(inversion?.reason).toMatch(/inversion_incomplete/)
    // The consensus check rides the inversion call, so social proof is unavailable too.
    const social = lattice.entries.find((e) => e.model === 'social_proof')
    expect(social?.status).toBe('unavailable')
  })

  it('E1: an objection that lost all its citations renders inversion unavailable (a fabricated counter-argument carries no weight)', () => {
    const lattice = buildMungerLattice({
      ...fullArgs(),
      inversion: { ...completeInversion, strongest_objection: { ...completeInversion.strongest_objection, citations: [] } },
    })
    const inversion = lattice.entries.find((e) => e.model === 'inversion')
    expect(inversion?.status).toBe('unavailable')
    expect(inversion?.reason).toMatch(/cite-check/i)
  })

  it('social proof is unavailable when the consensus check is ungrounded (uncited = no weight)', () => {
    const lattice = buildMungerLattice({
      ...fullArgs(),
      inversion: { ...completeInversion, consensus_check: { ...completeInversion.consensus_check, citations: [], grounded: false } },
    })
    const social = lattice.entries.find((e) => e.model === 'social_proof')
    expect(social?.status).toBe('unavailable')
    expect(social?.reason).toMatch(/ungrounded/i)
  })

  it('incentive analysis is unavailable when the comp structure did not ground', () => {
    const args = fullArgs()
    args.managementJudgment.integrity.comp_grounded = false
    const lattice = buildMungerLattice(args)
    const incentives = lattice.entries.find((e) => e.model === 'incentive_analysis')
    expect(incentives?.status).toBe('unavailable')
    expect(incentives?.reason).toMatch(/ground/i)
  })

  it('a consensus (non-variant) thesis renders the caution in the social-proof summary', () => {
    const lattice = buildMungerLattice({
      ...fullArgs(),
      inversion: {
        ...completeInversion,
        consensus_check: { ...completeInversion.consensus_check, thesis_vs_consensus: 'consensus' as const, variant_justification: undefined },
      },
    })
    const social = lattice.entries.find((e) => e.model === 'social_proof')
    expect(social?.status).toBe('applied')
    expect(social?.summary).toMatch(/thesis IS the consensus/i)
  })
})
