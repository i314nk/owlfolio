import { describe, expect, it } from 'vitest'

import type { CircleOfCompetenceConfig } from '@owlfolio/shared'

import { inCircle } from '../circleOfCompetence'

describe('inCircle', () => {
  describe('permissive default (enabled: false)', () => {
    it('admits a normal candidate', () => {
      const config: CircleOfCompetenceConfig = { enabled: false }
      expect(inCircle({ ticker: 'MSFT', sic: '7372', market_cap_musd: 3_000_000 }, config)).toEqual({
        in_circle: true,
      })
    })

    it('admits a candidate with missing/weird data and never rejects, even with lists/bounds present', () => {
      // enabled:false must short-circuit BEFORE any list/bound is consulted.
      const config: CircleOfCompetenceConfig = {
        enabled: false,
        allowed_sic_prefixes: ['12'],
        excluded_sic_prefixes: ['7372'],
        allowed_archetypes: ['compounder'],
        min_market_cap_musd: 10_000_000,
        max_market_cap_musd: 1,
      }
      expect(inCircle({ ticker: '???' }, config)).toEqual({ in_circle: true })
      expect(inCircle({ ticker: 'X', sic: '7372', market_cap_musd: 5, archetype: 'turnaround' }, config))
        .toEqual({ in_circle: true })
    })
  })

  describe('enabled excluded_sic_prefixes', () => {
    it('rejects a candidate whose sic prefix-matches an excluded prefix, naming the rule', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, excluded_sic_prefixes: ['60', '6022'] }
      const result = inCircle({ ticker: 'BANK', sic: '6022' }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/exclud/i)
      expect(result.reason).toContain('6022')
    })

    it('admits a candidate whose sic does not match any excluded prefix (no other restriction)', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, excluded_sic_prefixes: ['60'] }
      expect(inCircle({ ticker: 'MSFT', sic: '7372' }, config)).toEqual({ in_circle: true })
    })

    it('admits a candidate with unknown sic when there is no allowed-list (exclusions only)', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, excluded_sic_prefixes: ['60'] }
      expect(inCircle({ ticker: 'MSFT' }, config)).toEqual({ in_circle: true })
    })
  })

  describe('enabled allowed_sic_prefixes', () => {
    it('admits a candidate whose sic prefix-matches an allowed prefix', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, allowed_sic_prefixes: ['73'] }
      expect(inCircle({ ticker: 'MSFT', sic: '7372' }, config)).toEqual({ in_circle: true })
    })

    it('rejects a candidate whose sic does not prefix-match any allowed prefix, naming the rule + value', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, allowed_sic_prefixes: ['73'] }
      const result = inCircle({ ticker: 'BANK', sic: '6022' }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/allow/i)
      expect(result.reason).toContain('6022')
    })

    it('rejects a candidate with UNKNOWN sic under a non-empty allowed-list (cannot confirm in-circle)', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, allowed_sic_prefixes: ['73'] }
      const result = inCircle({ ticker: 'MSFT' }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/sic/i)
    })
  })

  describe('enabled allowed_archetypes', () => {
    it('admits a candidate whose archetype is allowed', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, allowed_archetypes: ['compounder', 'cannibal'] }
      expect(inCircle({ ticker: 'MSFT', archetype: 'compounder' }, config)).toEqual({ in_circle: true })
    })

    it('rejects a candidate whose archetype is not in the allowed list, naming the rule + value', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, allowed_archetypes: ['compounder'] }
      const result = inCircle({ ticker: 'X', archetype: 'turnaround' }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/archetype/i)
      expect(result.reason).toContain('turnaround')
    })

    it('rejects a candidate with unknown archetype under a non-empty allowed-archetype list', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, allowed_archetypes: ['compounder'] }
      const result = inCircle({ ticker: 'X' }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/archetype/i)
    })
  })

  describe('enabled market-cap bounds', () => {
    it('rejects a candidate below the min bound, naming the rule + value', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, min_market_cap_musd: 500 }
      const result = inCircle({ ticker: 'X', market_cap_musd: 100 }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/min/i)
      expect(result.reason).toContain('500')
    })

    it('rejects a candidate above the max bound, naming the rule + value', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, max_market_cap_musd: 50_000 }
      const result = inCircle({ ticker: 'X', market_cap_musd: 3_000_000 }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/max/i)
      expect(result.reason).toContain('50000')
    })

    it('admits a candidate inside both bounds', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, min_market_cap_musd: 500, max_market_cap_musd: 50_000 }
      expect(inCircle({ ticker: 'X', market_cap_musd: 10_000 }, config)).toEqual({ in_circle: true })
    })

    it('rejects a candidate with UNKNOWN market cap under a set bound (cannot confirm the bound)', () => {
      const config: CircleOfCompetenceConfig = { enabled: true, min_market_cap_musd: 500 }
      const result = inCircle({ ticker: 'X' }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/market.?cap/i)
    })
  })

  describe('deterministic rule order with multiple failures', () => {
    it('reports the excluded-sic rejection before any allowed/archetype/cap rule', () => {
      const config: CircleOfCompetenceConfig = {
        enabled: true,
        excluded_sic_prefixes: ['60'],
        allowed_sic_prefixes: ['73'],
        allowed_archetypes: ['compounder'],
        min_market_cap_musd: 1_000_000,
      }
      const result = inCircle({ ticker: 'X', sic: '6022', market_cap_musd: 1, archetype: 'turnaround' }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/exclud/i)
    })

    it('reports the allowed-sic rejection before archetype + cap when sic is the first failing rule', () => {
      const config: CircleOfCompetenceConfig = {
        enabled: true,
        allowed_sic_prefixes: ['73'],
        allowed_archetypes: ['compounder'],
        min_market_cap_musd: 1_000_000,
      }
      const result = inCircle({ ticker: 'X', sic: '6022', market_cap_musd: 1, archetype: 'turnaround' }, config)
      expect(result.in_circle).toBe(false)
      expect(result.reason).toMatch(/allow/i)
      expect(result.reason).toContain('6022')
    })
  })

  it('admits a fully-restricted-but-matching candidate (all gates pass)', () => {
    const config: CircleOfCompetenceConfig = {
      enabled: true,
      excluded_sic_prefixes: ['60'],
      allowed_sic_prefixes: ['73'],
      allowed_archetypes: ['compounder'],
      min_market_cap_musd: 500,
      max_market_cap_musd: 5_000_000,
    }
    expect(inCircle({ ticker: 'MSFT', sic: '7372', archetype: 'compounder', market_cap_musd: 3_000_000 }, config))
      .toEqual({ in_circle: true })
  })
})
