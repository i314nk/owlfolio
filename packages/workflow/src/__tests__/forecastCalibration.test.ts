import { describe, expect, it } from 'vitest'

import {
  brierScore,
  computeLaneCalibration,
  CALIBRATION_SHADING_MIN_RESOLVED,
  shouldActivateShading,
  type ResolvedForecast,
} from '../forecastCalibration.js'

describe('brierScore', () => {
  it('is (p - outcome)^2 for a correct confident call', () => {
    // said 0.8, resolved true (1) → (0.8 - 1)^2 = 0.04
    expect(brierScore(0.8, true)).toBeCloseTo(0.04, 10)
  })

  it('penalizes a confident wrong call heavily', () => {
    // said 0.9, resolved false (0) → 0.81
    expect(brierScore(0.9, false)).toBeCloseTo(0.81, 10)
  })

  it('a coin-flip 0.5 always scores 0.25', () => {
    expect(brierScore(0.5, true)).toBeCloseTo(0.25, 10)
    expect(brierScore(0.5, false)).toBeCloseTo(0.25, 10)
  })

  it('clamps probabilities outside [0,1] before scoring', () => {
    expect(brierScore(1.4, true)).toBeCloseTo(0, 10)
    expect(brierScore(-0.2, false)).toBeCloseTo(0, 10)
  })
})

describe('computeLaneCalibration', () => {
  const resolved: ResolvedForecast[] = [
    { lane: 'MOAT', p: 0.8, outcome: true },
    { lane: 'MOAT', p: 0.8, outcome: false },
    { lane: 'MOAT', p: 0.9, outcome: true },
    { lane: 'VALUATION', p: 0.6, outcome: true },
  ]

  it('groups by lane and computes mean Brier per lane', () => {
    const result = computeLaneCalibration(resolved)
    const moat = result.find((entry) => entry.lane === 'MOAT')
    expect(moat).toBeDefined()
    if (moat === undefined) throw new Error('no MOAT lane')
    expect(moat.resolved_count).toBe(3)
    // (0.04 + 0.64 + 0.01) / 3 = 0.23
    expect(moat.mean_brier).toBeCloseTo(0.23, 6)
  })

  it('builds a calibration curve bucketing stated-p vs empirical frequency', () => {
    const result = computeLaneCalibration(resolved)
    const moat = result.find((entry) => entry.lane === 'MOAT')
    if (moat === undefined) throw new Error('no MOAT lane')
    // two forecasts in the 0.8 bucket: one true one false → empirical 0.5
    const bucket80 = moat.calibration_curve.find((b) => b.stated_p_bucket === 0.8)
    expect(bucket80).toBeDefined()
    if (bucket80 === undefined) throw new Error('no 0.8 bucket')
    expect(bucket80.count).toBe(2)
    expect(bucket80.empirical_frequency).toBeCloseTo(0.5, 6)
  })

  it('flags overconfidence: stated p exceeds empirical frequency', () => {
    const result = computeLaneCalibration(resolved)
    const moat = result.find((entry) => entry.lane === 'MOAT')
    if (moat === undefined) throw new Error('no MOAT lane')
    // mean stated p across MOAT = (0.8+0.8+0.9)/3 = 0.8333; empirical = 2/3 = 0.6667 → overconfident
    expect(moat.mean_stated_p).toBeCloseTo(0.833333, 5)
    expect(moat.empirical_frequency).toBeCloseTo(0.666667, 5)
    expect(moat.overconfident).toBe(true)
  })

  it('empty input yields no lanes', () => {
    expect(computeLaneCalibration([])).toEqual([])
  })
})

describe('shading activation threshold (scaffold — wired by the judgment spec)', () => {
  it('the threshold constant is 30 resolved forecasts', () => {
    expect(CALIBRATION_SHADING_MIN_RESOLVED).toBe(30)
  })

  it('does not activate below the threshold', () => {
    expect(shouldActivateShading(29)).toBe(false)
  })

  it('activates at or above the threshold', () => {
    expect(shouldActivateShading(30)).toBe(true)
    expect(shouldActivateShading(45)).toBe(true)
  })
})
