import { describe, expect, it } from 'vitest'
import { defaultShariahDefaults } from '@owlfolio/shared/appConfig'
import { evaluateShariahPolicy, policyFromAppConfig } from '../index'

describe('AAOIFI Shariah policy evaluation', () => {
  it('uses the app-config AAOIFI defaults as the executable policy boundary', () => {
    const policy = policyFromAppConfig(defaultShariahDefaults())

    expect(policy).toMatchObject({
      policy_basis: 'AAOIFI',
      allow_conditional: true,
      non_compliant_income_threshold: 0.05,
    })
  })

  it('returns COMPLIANT when required evidence is present and non-compliant income is within the threshold', () => {
    const result = evaluateShariahPolicy({
      policy: policyFromAppConfig(defaultShariahDefaults()),
      subject: { ticker: 'COST', company_name: 'Costco Wholesale' },
      assessment: {
        business_activity: 'permissible',
        non_compliant_income_ratio: 0.049,
        evidence: [
          { requirement_id: 'business_activity', source_id: 'filing:10-k:2025', summary: 'Retail wholesaler; no prohibited primary business identified.' },
          { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:10-k:2025', summary: 'Estimated non-compliant income is 4.9% of revenue.', value: 0.049 },
        ],
      },
    })

    expect(result.status).toBe('COMPLIANT')
    expect(result.requires_user_confirmation).toBe(false)
    expect(result.failed_requirements).toEqual([])
    expect(result.missing_evidence).toEqual([])
  })

  it('returns NON_COMPLIANT when non-compliant income exceeds the configured threshold', () => {
    const result = evaluateShariahPolicy({
      policy: policyFromAppConfig({ ...defaultShariahDefaults(), non_compliant_income_threshold: 0.05 }),
      subject: { ticker: 'INTC', company_name: 'Income Threshold Example' },
      assessment: {
        business_activity: 'permissible',
        non_compliant_income_ratio: 0.051,
        evidence: [
          { requirement_id: 'business_activity', source_id: 'filing:10-k:2025', summary: 'Primary business appears permissible.' },
          { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:10-k:2025', summary: 'Estimated non-compliant income is 5.1% of revenue.', value: 0.051 },
        ],
      },
    })

    expect(result.status).toBe('NON_COMPLIANT')
    expect(result.failed_requirements).toEqual(['non_compliant_income_ratio'])
    expect(result.reasons[0]).toContain('exceeds AAOIFI default threshold')
  })

  it('returns CONDITIONAL for threshold-equal or explicitly uncertain cases when conditional handling is allowed', () => {
    const thresholdEqual = evaluateShariahPolicy({
      policy: policyFromAppConfig(defaultShariahDefaults()),
      subject: { ticker: 'EQAL' },
      assessment: {
        business_activity: 'permissible',
        non_compliant_income_ratio: 0.05,
        evidence: [
          { requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Primary business appears permissible.' },
          { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:annual', summary: 'Non-compliant income is exactly at the policy threshold.', value: 0.05 },
        ],
      },
    })
    const uncertain = evaluateShariahPolicy({
      policy: policyFromAppConfig(defaultShariahDefaults()),
      subject: { ticker: 'COND' },
      assessment: {
        business_activity: 'uncertain',
        non_compliant_income_ratio: 0.02,
        evidence: [
          { requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Mixed business lines need scholar/operator review.' },
          { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:annual', summary: 'Estimated non-compliant income is 2%.', value: 0.02 },
        ],
      },
    })

    expect(thresholdEqual.status).toBe('CONDITIONAL')
    expect(thresholdEqual.requires_user_confirmation).toBe(true)
    expect(thresholdEqual.conditional_requirements).toContain('non_compliant_income_ratio')
    expect(uncertain.status).toBe('CONDITIONAL')
    expect(uncertain.conditional_requirements).toContain('business_activity')
  })

  it('does not allow CONDITIONAL when the policy disables conditional handling', () => {
    const result = evaluateShariahPolicy({
      policy: policyFromAppConfig({ ...defaultShariahDefaults(), allow_conditional: false }),
      subject: { ticker: 'COND' },
      assessment: {
        business_activity: 'uncertain',
        non_compliant_income_ratio: 0.02,
        evidence: [
          { requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Mixed business lines need scholar/operator review.' },
          { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:annual', summary: 'Estimated non-compliant income is 2%.', value: 0.02 },
        ],
      },
    })

    expect(result.status).toBe('PENDING')
    expect(result.reasons).toContain('Conditional findings require policy support before they can pass review.')
  })

  it('returns PENDING when the app-config Shariah screen is disabled instead of silently passing', () => {
    const result = evaluateShariahPolicy({
      policy: policyFromAppConfig({ ...defaultShariahDefaults(), enabled: false }),
      subject: { ticker: 'OFF' },
      assessment: {
        business_activity: 'permissible',
        non_compliant_income_ratio: 0.01,
        evidence: [
          { requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Primary business appears permissible.' },
          { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:annual', summary: 'Estimated non-compliant income is 1%.', value: 0.01 },
        ],
      },
    })

    expect(result.status).toBe('PENDING')
    expect(result.reasons).toContain('Shariah screening is disabled in app configuration.')
  })

  it('returns PENDING until every required requirement has sourced evidence and a usable value', () => {
    const result = evaluateShariahPolicy({
      policy: policyFromAppConfig(defaultShariahDefaults()),
      subject: { ticker: 'MISS' },
      assessment: {
        business_activity: 'permissible',
        evidence: [{ requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Primary business appears permissible.' }],
      },
    })

    expect(result.status).toBe('PENDING')
    expect(result.missing_evidence).toEqual(['non_compliant_income_ratio'])
    expect(result.reasons).toContain('Missing sourced evidence for non_compliant_income_ratio.')
  })

  it('keeps sourced prohibited business activity NON_COMPLIANT even when other evidence is incomplete', () => {
    const result = evaluateShariahPolicy({
      policy: policyFromAppConfig(defaultShariahDefaults()),
      subject: { ticker: 'BANK' },
      assessment: {
        business_activity: 'prohibited',
        evidence: [
          { requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Primary business is conventional interest-based lending.' },
        ],
      },
    })

    expect(result.status).toBe('NON_COMPLIANT')
    expect(result.failed_requirements).toEqual(['business_activity'])
    expect(result.missing_evidence).toEqual(['non_compliant_income_ratio'])
  })

  it('does not treat invalid non-compliant income ratios as COMPLIANT', () => {
    for (const invalidRatio of [Number.NaN, -0.01]) {
      const result = evaluateShariahPolicy({
        policy: policyFromAppConfig(defaultShariahDefaults()),
        subject: { ticker: 'BADRATIO' },
        assessment: {
          business_activity: 'permissible',
          non_compliant_income_ratio: invalidRatio,
          evidence: [
            { requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Primary business appears permissible.' },
            { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:annual', summary: 'Invalid ratio cannot support a passing decision.', value: invalidRatio },
          ],
        },
      })

      expect(result.status).toBe('PENDING')
      expect(result.missing_evidence).toEqual(['non_compliant_income_ratio'])
      expect(result.requires_user_confirmation).toBe(true)
    }
  })

  it('returns PENDING for invalid non-compliant income ratios instead of passing malformed evidence', () => {
    for (const non_compliant_income_ratio of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      const result = evaluateShariahPolicy({
        policy: policyFromAppConfig(defaultShariahDefaults()),
        subject: { ticker: 'BADRATIO' },
        assessment: {
          business_activity: 'permissible',
          non_compliant_income_ratio,
          evidence: [
            { requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Primary business appears permissible.' },
            { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:annual', summary: 'Malformed ratio should not be accepted.', value: non_compliant_income_ratio },
          ],
        },
      })

      expect(result.status).toBe('PENDING')
      expect(result.missing_evidence).toEqual(['non_compliant_income_ratio'])
    }
  })

  it('does not count whitespace-only source evidence as sourced evidence', () => {
    const result = evaluateShariahPolicy({
      policy: policyFromAppConfig(defaultShariahDefaults()),
      subject: { ticker: 'BLANK' },
      assessment: {
        business_activity: 'permissible',
        non_compliant_income_ratio: 0.01,
        evidence: [
          { requirement_id: 'business_activity', source_id: ' ', summary: ' ' },
          { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:annual', summary: 'Estimated non-compliant income is 1%.', value: 0.01 },
        ],
      },
    })

    expect(result.status).toBe('PENDING')
    expect(result.missing_evidence).toEqual(['business_activity'])
  })

  it('returns NON_COMPLIANT for prohibited business activity even when income ratio is below threshold', () => {
    const result = evaluateShariahPolicy({
      policy: policyFromAppConfig(defaultShariahDefaults()),
      subject: { ticker: 'BANK' },
      assessment: {
        business_activity: 'prohibited',
        non_compliant_income_ratio: 0.01,
        evidence: [
          { requirement_id: 'business_activity', source_id: 'filing:annual', summary: 'Primary business is conventional interest-based lending.' },
          { requirement_id: 'non_compliant_income_ratio', source_id: 'filing:annual', summary: 'Non-compliant income estimate is below 5%.', value: 0.01 },
        ],
      },
    })

    expect(result.status).toBe('NON_COMPLIANT')
    expect(result.failed_requirements).toEqual(['business_activity'])
  })
})
