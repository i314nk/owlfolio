import { describe, expect, it } from 'vitest'
import {
  sanitizeRoicLike,
  sanitizeMarginOfSafety,
  sanitizeReinvestmentRate,
  sanitizeTerminalGrowth,
  sanitizeMaintenanceCapex,
  sanitizeShares,
  sanitizeWorkingCapitalChange,
  anchorNetIncomeToEdgar,
  OE_NORMALIZATION_MAX_FRACTION,
} from '../rangeSanity'

describe('sanitizeRoicLike (incremental_roic / roic > 100% rejected)', () => {
  it('passes a plausible fraction through unflagged', () => {
    const r = sanitizeRoicLike(0.2, { field: 'incremental_roic' })
    expect(r.value).toBe(0.2)
    expect(r.rejected).toBe(false)
    expect(r.flag).toBeUndefined()
  })

  it('rejects inc-ROIC of 1.5 (150%) and does NOT feed it to the valuation', () => {
    const r = sanitizeRoicLike(1.5, { field: 'incremental_roic' })
    expect(r.rejected).toBe(true)
    // Falls back to the safe not-computable value (undefined) — never the garbage number.
    expect(r.value).toBeUndefined()
    expect(r.flag).toMatch(/incremental_roic/)
    expect(r.flag).toMatch(/1\.5|150/)
  })

  it('rejects a negative ROIC', () => {
    const r = sanitizeRoicLike(-0.1, { field: 'roic' })
    expect(r.rejected).toBe(true)
    expect(r.value).toBeUndefined()
  })

  it('rejects a non-finite value', () => {
    expect(sanitizeRoicLike(Number.NaN, { field: 'roic' }).rejected).toBe(true)
    expect(sanitizeRoicLike(Number.POSITIVE_INFINITY, { field: 'roic' }).rejected).toBe(true)
  })
})

describe('sanitizeMaintenanceCapex (maint capex > revenue rejected)', () => {
  it('passes maintenance capex below revenue', () => {
    const r = sanitizeMaintenanceCapex(300, { revenue: 1000 })
    expect(r.rejected).toBe(false)
    expect(r.value).toBe(300)
  })

  it('flags maintenance capex exceeding revenue', () => {
    const r = sanitizeMaintenanceCapex(1500, { revenue: 1000 })
    expect(r.rejected).toBe(true)
    expect(r.value).toBeUndefined()
    expect(r.flag).toMatch(/maintenance_capex/)
  })

  it('rejects negative maintenance capex', () => {
    expect(sanitizeMaintenanceCapex(-10, { revenue: 1000 }).rejected).toBe(true)
  })
})

describe('sanitizeShares', () => {
  it('rejects negative or zero shares', () => {
    expect(sanitizeShares(-5).rejected).toBe(true)
    expect(sanitizeShares(0).rejected).toBe(true)
    expect(sanitizeShares(100).rejected).toBe(false)
  })
})

describe('sanitizeMarginOfSafety [0,1]', () => {
  it('accepts a fraction in band', () => {
    expect(sanitizeMarginOfSafety(0.25).rejected).toBe(false)
  })
  it('rejects > 1 and < 0', () => {
    expect(sanitizeMarginOfSafety(1.5).rejected).toBe(true)
    expect(sanitizeMarginOfSafety(-0.1).rejected).toBe(true)
  })
})

describe('sanitizeReinvestmentRate [0, 2]', () => {
  it('accepts in band, rejects implausible', () => {
    expect(sanitizeReinvestmentRate(0.4).rejected).toBe(false)
    expect(sanitizeReinvestmentRate(2.5).rejected).toBe(true)
    expect(sanitizeReinvestmentRate(-0.1).rejected).toBe(true)
  })
})

describe('sanitizeTerminalGrowth [0, 0.05]', () => {
  it('accepts in band, rejects out of band', () => {
    expect(sanitizeTerminalGrowth(0.025).rejected).toBe(false)
    expect(sanitizeTerminalGrowth(0.08).rejected).toBe(true)
    expect(sanitizeTerminalGrowth(-0.01).rejected).toBe(true)
  })
})

describe('anchorNetIncomeToEdgar (bounded ±35% normalization off EDGAR reported)', () => {
  it('exposes the normalization bound', () => {
    expect(OE_NORMALIZATION_MAX_FRACTION).toBe(0.35)
  })

  it('model net_income=0 while EDGAR positive → clamps to lower band edge + flags', () => {
    const r = anchorNetIncomeToEdgar(0, 8099)
    expect(r.clamped).toBe(true)
    expect(r.value).toBeCloseTo(8099 * 0.65, 2)
    expect(r.flag).toMatch(/oe_bridge_net_income_clamped/)
  })

  it('proposal within band → used as-is, not clamped, no flag', () => {
    const r = anchorNetIncomeToEdgar(7500, 8099)
    expect(r.clamped).toBe(false)
    expect(r.value).toBe(7500)
    expect(r.flag).toBeUndefined()
  })

  it('proposal above band → clamps to upper edge', () => {
    const r = anchorNetIncomeToEdgar(20000, 8099)
    expect(r.clamped).toBe(true)
    expect(r.value).toBeCloseTo(8099 * 1.35, 2)
  })

  it('non-finite proposal → clamps to lower band edge', () => {
    const r = anchorNetIncomeToEdgar(Number.NaN, 8099)
    expect(r.clamped).toBe(true)
    expect(r.value).toBeCloseTo(8099 * 0.65, 2)
  })

  it('non-finite EDGAR figure → keeps model proposal (caller uses model path)', () => {
    const r = anchorNetIncomeToEdgar(1234, Number.NaN)
    expect(r.clamped).toBe(false)
    expect(r.value).toBe(1234)
  })
})

describe('sanitizeWorkingCapitalChange (|ΔNWC| > |revenue| rejected)', () => {
  it('accepts a signed change within |revenue|', () => {
    expect(sanitizeWorkingCapitalChange(-1000, { revenue: 275000 }).rejected).toBe(false)
    expect(sanitizeWorkingCapitalChange(-1000, { revenue: 275000 }).value).toBe(-1000)
  })
  it('rejects a magnitude exceeding |revenue|', () => {
    expect(sanitizeWorkingCapitalChange(300000, { revenue: 275000 }).rejected).toBe(true)
    expect(sanitizeWorkingCapitalChange(-300000, { revenue: 275000 }).rejected).toBe(true)
  })
  it('rejects non-finite', () => {
    expect(sanitizeWorkingCapitalChange(Number.NaN, { revenue: 275000 }).rejected).toBe(true)
  })
})
