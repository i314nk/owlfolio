import { describe, expect, it } from 'vitest'
import {
  JUDGMENT_RUBRICS,
  tierForScore,
  orderedTiers,
  tierIndex,
  computableItemIds,
  maxTotalScore,
  maxComputableScore,
} from '../judgmentRubrics'

describe('JUDGMENT_RUBRICS (versioned config)', () => {
  it('carries a version field', () => {
    expect(typeof JUDGMENT_RUBRICS.version).toBe('string')
    expect(JUDGMENT_RUBRICS.version.length).toBeGreaterThan(0)
  })

  it('defines the four rubrics with the expected item counts', () => {
    expect(JUDGMENT_RUBRICS.moat.items).toHaveLength(6)
    expect(JUDGMENT_RUBRICS.management.items).toHaveLength(6)
    expect(JUDGMENT_RUBRICS.predictability.items).toHaveLength(5)
    expect(JUDGMENT_RUBRICS.runway.items).toHaveLength(3)
  })

  it('every item is scored 0/1/2 (max_score 2)', () => {
    for (const r of [JUDGMENT_RUBRICS.moat, JUDGMENT_RUBRICS.management, JUDGMENT_RUBRICS.predictability, JUDGMENT_RUBRICS.runway]) {
      for (const item of r.items) expect(item.max_score).toBe(2)
    }
  })

  it('marks M1, M2 as computable and M3-M6 as cited (moat)', () => {
    expect(computableItemIds(JUDGMENT_RUBRICS.moat)).toEqual(['M1', 'M2'])
    expect(maxComputableScore(JUDGMENT_RUBRICS.moat)).toBe(4)
    expect(maxTotalScore(JUDGMENT_RUBRICS.moat)).toBe(12)
  })

  it('marks R1 as the only computable runway row', () => {
    expect(computableItemIds(JUDGMENT_RUBRICS.runway)).toEqual(['R1'])
    expect(maxComputableScore(JUDGMENT_RUBRICS.runway)).toBe(2)
  })

  it('management and predictability rubrics are entirely cited', () => {
    expect(computableItemIds(JUDGMENT_RUBRICS.management)).toEqual([])
    expect(computableItemIds(JUDGMENT_RUBRICS.predictability)).toEqual([])
  })
})

describe('tierForScore — moat mapping (spec Mechanism 1)', () => {
  const moat = JUDGMENT_RUBRICS.moat
  it('maps score 11 -> monopoly', () => expect(tierForScore(moat, 11)).toBe('monopoly'))
  it('maps score 10 -> monopoly (boundary)', () => expect(tierForScore(moat, 10)).toBe('monopoly'))
  it('maps score 9 -> wide', () => expect(tierForScore(moat, 9)).toBe('wide'))
  it('maps score 8 -> wide', () => expect(tierForScore(moat, 8)).toBe('wide'))
  it('maps score 7 -> wide (boundary)', () => expect(tierForScore(moat, 7)).toBe('wide'))
  it('maps score 6 -> moderate', () => expect(tierForScore(moat, 6)).toBe('moderate'))
  it('maps score 5 -> moderate', () => expect(tierForScore(moat, 5)).toBe('moderate'))
  it('maps score 4 -> moderate (boundary)', () => expect(tierForScore(moat, 4)).toBe('moderate'))
  it('maps score 3 -> narrow', () => expect(tierForScore(moat, 3)).toBe('narrow'))
  it('maps score 0 -> narrow', () => expect(tierForScore(moat, 0)).toBe('narrow'))
})

describe('tierForScore — runway mapping (downstream proven/limited/none contract)', () => {
  const runway = JUDGMENT_RUBRICS.runway
  it('maps 5 -> proven', () => expect(tierForScore(runway, 5)).toBe('proven'))
  it('maps 6 -> proven', () => expect(tierForScore(runway, 6)).toBe('proven'))
  it('maps 4 -> limited', () => expect(tierForScore(runway, 4)).toBe('limited'))
  it('maps 2 -> limited', () => expect(tierForScore(runway, 2)).toBe('limited'))
  it('maps 1 -> none', () => expect(tierForScore(runway, 1)).toBe('none'))
  it('maps 0 -> none', () => expect(tierForScore(runway, 0)).toBe('none'))
})

describe('orderedTiers / tierIndex', () => {
  it('orders moat tiers narrow < moderate < wide < monopoly', () => {
    expect(orderedTiers(JUDGMENT_RUBRICS.moat)).toEqual(['narrow', 'moderate', 'wide', 'monopoly'])
  })
  it('tierIndex reflects ordering', () => {
    const moat = JUDGMENT_RUBRICS.moat
    expect(tierIndex(moat, 'narrow')).toBe(0)
    expect(tierIndex(moat, 'wide')).toBe(2)
    expect(tierIndex(moat, 'monopoly')).toBe(3)
    expect(tierIndex(moat, 'unknown')).toBe(-1)
  })
  it('orders runway none < limited < proven', () => {
    expect(orderedTiers(JUDGMENT_RUBRICS.runway)).toEqual(['none', 'limited', 'proven'])
  })
})
