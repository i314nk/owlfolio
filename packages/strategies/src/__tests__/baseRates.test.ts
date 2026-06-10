import { describe, expect, it } from 'vitest'
import { BASE_RATES, baseRateById } from '../baseRates'

describe('BASE_RATES versioned config', () => {
  it('is versioned', () => {
    expect(BASE_RATES.version).toMatch(/base-rates/)
  })

  it('contains the starter-table entries with id, claim, base_rate_note, burden', () => {
    const ids = BASE_RATES.entries.map((e) => e.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'oe_double_digit_10yr',
        'roic_gt_20_decade',
        'monopoly_classification',
        'margin_expansion',
        'credited_g_4_5',
      ]),
    )
    for (const e of BASE_RATES.entries) {
      expect(e.claim.length).toBeGreaterThan(0)
      expect(e.base_rate_note.length).toBeGreaterThan(0)
      expect(e.burden.length).toBeGreaterThan(0)
      // The rarer the base rate, the higher the structural-evidence requirement.
      expect(e.min_structural_evidence).toBeGreaterThanOrEqual(1)
    }
  })

  it('monopoly is rarer than margin-expansion → demands more structural evidence', () => {
    const monopoly = baseRateById('monopoly_classification')
    const margin = baseRateById('margin_expansion')
    expect(monopoly).toBeDefined()
    expect(margin).toBeDefined()
    expect(monopoly!.min_structural_evidence).toBeGreaterThanOrEqual(margin!.min_structural_evidence)
  })
})
