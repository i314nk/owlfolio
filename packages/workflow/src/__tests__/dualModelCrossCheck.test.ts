import { describe, expect, it } from 'vitest'

import {
  compareMoatClass,
  compareShariahSectorStatus,
  resolveCrossCheck,
  type CrossCheckClassification,
} from '../dualModelCrossCheck'

describe('compareMoatClass — conservative = lower tier', () => {
  it('agrees on an exact match', () => {
    const r = compareMoatClass('wide', 'wide')
    expect(r.agreed).toBe(true)
    expect(r.conservative).toBe('wide')
  })

  it('disagrees and takes the LOWER (more conservative) tier', () => {
    const r = compareMoatClass('wide', 'moderate')
    expect(r.agreed).toBe(false)
    expect(r.conservative).toBe('moderate')
  })

  it('takes the lower tier regardless of argument order', () => {
    expect(compareMoatClass('narrow', 'monopoly').conservative).toBe('narrow')
    expect(compareMoatClass('monopoly', 'narrow').conservative).toBe('narrow')
  })
})

describe('compareShariahSectorStatus — conservative = stricter', () => {
  it('agrees on an exact match', () => {
    const r = compareShariahSectorStatus('compliant', 'compliant')
    expect(r.agreed).toBe(true)
    expect(r.conservative).toBe('compliant')
  })

  it('disagrees and takes the STRICTER status (non_compliant > conditional > compliant)', () => {
    expect(compareShariahSectorStatus('compliant', 'conditional').conservative).toBe('conditional')
    expect(compareShariahSectorStatus('conditional', 'non_compliant').conservative).toBe('non_compliant')
    expect(compareShariahSectorStatus('non_compliant', 'compliant').conservative).toBe('non_compliant')
  })
})

// Two stub "models" for the integration-shaped resolveCrossCheck. Each returns a classification.
function stubClassifier<T extends CrossCheckClassification>(value: T) {
  return async () => value
}

describe('resolveCrossCheck — wiring', () => {
  it('AGREEMENT → proceeds with the agreed value, agreed:true, no escalation', async () => {
    const result = await resolveCrossCheck({
      dimension: 'moat_class',
      primary: 'wide',
      primaryModel: 'model-a',
      crossCheckModel: 'model-b',
      runCrossCheck: stubClassifier('wide'),
      compare: compareMoatClass,
    })
    expect(result.ran).toBe(true)
    expect(result.crosscheck?.agreed).toBe(true)
    expect(result.value).toBe('wide')
    expect(result.requires_human_escalation).toBe(false)
    expect(result.crosscheck?.models).toEqual(['model-a', 'model-b'])
  })

  it('DISAGREEMENT → conservative value holds + requires_human_escalation flag', async () => {
    const result = await resolveCrossCheck({
      dimension: 'moat_class',
      primary: 'wide',
      primaryModel: 'model-a',
      crossCheckModel: 'model-b',
      runCrossCheck: stubClassifier('moderate'),
      compare: compareMoatClass,
    })
    expect(result.crosscheck?.agreed).toBe(false)
    expect(result.value).toBe('moderate') // conservative holds in the meantime
    expect(result.requires_human_escalation).toBe(true)
    expect(result.escalation_note).toContain('moat_class')
  })

  it('DISAGREEMENT on Shariah → stricter status holds + escalation', async () => {
    const result = await resolveCrossCheck({
      dimension: 'shariah_sector_status',
      primary: 'compliant',
      primaryModel: 'model-a',
      crossCheckModel: 'model-b',
      runCrossCheck: stubClassifier('non_compliant'),
      compare: compareShariahSectorStatus,
    })
    expect(result.value).toBe('non_compliant')
    expect(result.requires_human_escalation).toBe(true)
  })

  it('DEGRADES (no escalation) when the cross-check run THROWS — primary holds, gap surfaced', async () => {
    const result = await resolveCrossCheck({
      dimension: 'moat_class',
      primary: 'wide',
      primaryModel: 'model-a',
      crossCheckModel: 'model-b',
      runCrossCheck: async () => { throw new Error('cross-check timed out') },
      compare: compareMoatClass,
    })
    expect(result.ran).toBe(true)
    expect(result.value).toBe('wide') // primary holds
    expect(result.crosscheck?.agreed).toBeUndefined()
    expect(result.degraded_note).toContain('cross-check')
    expect(result.requires_human_escalation).toBe(false)
  })
})
