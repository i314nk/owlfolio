import { describe, expect, it } from 'vitest'
import { resolveManagementJudgment, type ManagementLaneThesis } from '../researchSwarmCompute'

// ---------------------------------------------------------------------------------------------------
// S5 (Phase 3 pillars): the management pillar's two core traits (owner-locked 2026-07-11) —
// INTEGRITY (communication monitoring + executive-comp structure) and TALENT (ROIC / payout / debt,
// T0-anchored) — resolved with the SAME grounding spine as the moat/circle: the worst tiers
// (red_flag / poor) are honored ONLY when grounded, because they carry VETO teeth downstream
// (BUY → RESEARCH_MORE naming the failed trait). Ungrounded claims render unverified, no weight;
// an absent judgment block resolves 'undetermined' — never a silent clean bill.
// ---------------------------------------------------------------------------------------------------

const VERIFIED = new Set(['src_def14a_2025', 'src_10k_2025'])

function thesis(overrides: Partial<ManagementLaneThesis> = {}): ManagementLaneThesis {
  return {
    integrity: {
      communication_observations: [
        { observation: 'MD&A discusses the failed segment plainly, quantified', citation: 'src_10k_2025' },
      ],
      comp_structure: {
        summary: 'Cash bonus on ROIC and per-share FCF growth; PSUs on 3-yr relative TSR.',
        incentive_metrics: ['ROIC', 'FCF/share', 'relative TSR'],
        alignment: 'aligned',
        citation: 'src_def14a_2025',
      },
      integrity_flags: [],
      proposed_integrity: 'clean',
      integrity_reasoning: 'Candid communication; owner-aligned comp.',
    },
    talent: {
      talent_drivers: [
        { evidence: 'Ten years of >15% ROIC through two cycles', citation: 'src_10k_2025' },
        { evidence: 'Buybacks concentrated in drawdown years below intrinsic value', citation: 'src_def14a_2025' },
      ],
      proposed_talent: 'excellent',
      talent_reasoning: 'Capital allocation discipline demonstrated.',
    },
    ...overrides,
  }
}

describe('resolveManagementJudgment — grounding matrix', () => {
  it('honors a grounded clean + excellent judgment', () => {
    const r = resolveManagementJudgment({ thesis: thesis(), verifiedCitationHashes: VERIFIED })
    expect(r.resolved_integrity).toBe('clean')
    expect(r.resolved_talent).toBe('excellent')
    expect(r.judgment_degraded).not.toBe(true)
    expect(r.integrity?.comp_grounded).toBe(true)
  })

  it('honors red_flag ONLY with a grounded HIGH-severity flag (the veto can never fire on hallucination)', () => {
    const grounded = resolveManagementJudgment({
      thesis: thesis({
        integrity: {
          ...thesis().integrity!,
          integrity_flags: [{ claim: 'Undisclosed related-party purchases from the CEO\'s brother\'s firm', severity: 'high', citation: 'src_def14a_2025' }],
          proposed_integrity: 'red_flag',
        },
      }),
      verifiedCitationHashes: VERIFIED,
    })
    expect(grounded.resolved_integrity).toBe('red_flag')

    const ungrounded = resolveManagementJudgment({
      thesis: thesis({
        integrity: {
          ...thesis().integrity!,
          integrity_flags: [{ claim: 'Rumored self-dealing', severity: 'high', citation: 'src_never_captured' }],
          proposed_integrity: 'red_flag',
        },
      }),
      verifiedCitationHashes: VERIFIED,
    })
    expect(ungrounded.resolved_integrity).toBe('undetermined')
    expect(ungrounded.integrity?.flags?.[0]?.grounded).toBe(false)

    const lowSeverityOnly = resolveManagementJudgment({
      thesis: thesis({
        integrity: {
          ...thesis().integrity!,
          integrity_flags: [{ claim: 'Perk disclosure is thin', severity: 'low', citation: 'src_def14a_2025' }],
          proposed_integrity: 'red_flag',
        },
      }),
      verifiedCitationHashes: VERIFIED,
    })
    expect(lowSeverityOnly.resolved_integrity).toBe('undetermined')
  })

  it("honors 'poor' talent only when grounded; 'excellent' needs >=2 grounded drivers", () => {
    const poorGrounded = resolveManagementJudgment({
      thesis: thesis({
        talent: {
          talent_drivers: [{ evidence: 'Serial dilutive acquisitions written down within 3 years', citation: 'src_10k_2025' }],
          proposed_talent: 'poor',
          talent_reasoning: 'Empire building.',
        },
      }),
      verifiedCitationHashes: VERIFIED,
    })
    expect(poorGrounded.resolved_talent).toBe('poor')

    const poorUngrounded = resolveManagementJudgment({
      thesis: thesis({
        talent: {
          talent_drivers: [{ evidence: 'Vibes', citation: 'src_never_captured' }],
          proposed_talent: 'poor',
          talent_reasoning: 'Ungrounded.',
        },
      }),
      verifiedCitationHashes: VERIFIED,
    })
    expect(poorUngrounded.resolved_talent).toBe('undetermined')

    const excellentOneDriver = resolveManagementJudgment({
      thesis: thesis({
        talent: {
          talent_drivers: [{ evidence: 'One grounded driver only', citation: 'src_10k_2025' }],
          proposed_talent: 'excellent',
          talent_reasoning: 'Reaches for excellent on one driver.',
        },
      }),
      verifiedCitationHashes: VERIFIED,
    })
    expect(excellentOneDriver.resolved_talent).toBe('adequate') // capped by grounded-driver count
    expect(excellentOneDriver.talent?.talent_grounding_capped).toBe(true)
  })

  it("a 'clean' claim without a grounded comp citation resolves undetermined (clean must be demonstrated)", () => {
    const r = resolveManagementJudgment({
      thesis: thesis({
        integrity: {
          ...thesis().integrity!,
          comp_structure: { ...thesis().integrity!.comp_structure, citation: 'src_never_captured' },
        },
      }),
      verifiedCitationHashes: VERIFIED,
    })
    expect(r.resolved_integrity).toBe('undetermined')
    expect(r.integrity?.comp_grounded).toBe(false)
  })

  it('an absent judgment block resolves undetermined + judgment_degraded (never a silent clean)', () => {
    const r = resolveManagementJudgment({ thesis: {}, verifiedCitationHashes: VERIFIED })
    expect(r.resolved_integrity).toBe('undetermined')
    expect(r.resolved_talent).toBe('undetermined')
    expect(r.judgment_degraded).toBe(true)
  })

  it('flags t0_contradicts_talent (advisory) when a grounded excellent sits on a weak T0 ROIC', () => {
    const r = resolveManagementJudgment({
      thesis: thesis(),
      verifiedCitationHashes: VERIFIED,
      t0RoicBand: 'weak',
    })
    expect(r.resolved_talent).toBe('excellent') // advisory, never blocks
    expect(r.t0_contradicts_talent).toBe(true)
  })
})
