import { describe, expect, it } from 'vitest'
import { isResearchCaseStale, selectResearchCaseAction, type ResearchCaseAction, type ResearchTrigger } from '../researchCasePolicy'

const NOW = new Date('2026-06-09T00:00:00.000Z')
const FRESH_CREATED_AT = '2026-05-01T00:00:00.000Z' // ~39 days ago — not stale at 90-day cadence
const STALE_CREATED_AT = '2026-01-01T00:00:00.000Z' // ~159 days ago — stale at 90-day cadence

const LATEST_V1 = {
  research_case_id: 'rc_aapl_001',
  created_at: FRESH_CREATED_AT,
  version: 1,
}

const LATEST_V1_STALE = {
  ...LATEST_V1,
  created_at: STALE_CREATED_AT,
}

describe('isResearchCaseStale', () => {
  it('returns false when age is less than cadence days', () => {
    expect(isResearchCaseStale(FRESH_CREATED_AT, NOW, 90)).toBe(false)
  })

  it('returns true when age equals cadence days exactly', () => {
    // 90 days before NOW = 2026-03-11T00:00:00.000Z
    const exactlyAtBoundary = '2026-03-11T00:00:00.000Z'
    expect(isResearchCaseStale(exactlyAtBoundary, NOW, 90)).toBe(true)
  })

  it('returns true when age exceeds cadence days', () => {
    expect(isResearchCaseStale(STALE_CREATED_AT, NOW, 90)).toBe(true)
  })

  it('uses 90-day default when cadenceDays is omitted', () => {
    expect(isResearchCaseStale(FRESH_CREATED_AT, NOW)).toBe(false)
    expect(isResearchCaseStale(STALE_CREATED_AT, NOW)).toBe(true)
  })

  it('respects a custom cadence (e.g. 30-day monthly)', () => {
    const thirtyOneDaysAgo = '2026-05-09T00:00:00.000Z'
    // 31 days ago, cadence = 30 → stale
    expect(isResearchCaseStale(thirtyOneDaysAgo, NOW, 30)).toBe(true)
    // 20 days ago, cadence = 30 → not stale
    const twentyDaysAgo = '2026-05-20T00:00:00.000Z'
    expect(isResearchCaseStale(twentyDaysAgo, NOW, 30)).toBe(false)
  })
})

describe('selectResearchCaseAction', () => {
  // Table: trigger × latestCase (none / fresh / stale) → expected action
  const table: Array<{
    trigger: ResearchTrigger
    latestCase: typeof LATEST_V1 | typeof LATEST_V1_STALE | undefined
    expected: ResearchCaseAction
    label: string
  }> = [
    // No prior case — always create_first regardless of trigger
    { trigger: 'user', latestCase: undefined, expected: 'create_first', label: 'user, no prior → create_first' },
    { trigger: 'automated_discovery', latestCase: undefined, expected: 'create_first', label: 'automated_discovery, no prior → create_first' },
    { trigger: 'scheduled_reanalysis', latestCase: undefined, expected: 'create_first', label: 'scheduled_reanalysis, no prior → create_first' },

    // User re-run — always create_version when prior exists
    { trigger: 'user', latestCase: LATEST_V1, expected: 'create_version', label: 'user, fresh prior → create_version' },
    { trigger: 'user', latestCase: LATEST_V1_STALE, expected: 'create_version', label: 'user, stale prior → create_version' },

    // Automated discovery — dedup: reuse fresh, version stale
    { trigger: 'automated_discovery', latestCase: LATEST_V1, expected: 'reuse_existing', label: 'automated_discovery, fresh prior → reuse_existing' },
    { trigger: 'automated_discovery', latestCase: LATEST_V1_STALE, expected: 'create_version', label: 'automated_discovery, stale prior → create_version' },

    // Scheduled reanalysis — always version
    { trigger: 'scheduled_reanalysis', latestCase: LATEST_V1, expected: 'create_version', label: 'scheduled_reanalysis, fresh prior → create_version' },
    { trigger: 'scheduled_reanalysis', latestCase: LATEST_V1_STALE, expected: 'create_version', label: 'scheduled_reanalysis, stale prior → create_version' },
  ]

  it.each(table)('$label', ({ trigger, latestCase, expected }) => {
    const result = selectResearchCaseAction({
      trigger,
      now: NOW,
      ...(latestCase !== undefined ? { latestCase } : {}),
    })
    expect(result).toBe(expected)
  })

  it('respects a custom reanalysisCadenceDays for automated_discovery', () => {
    // 39 days old, cadence = 30 → stale → create_version
    expect(selectResearchCaseAction({
      trigger: 'automated_discovery',
      latestCase: LATEST_V1,
      now: NOW,
      reanalysisCadenceDays: 30,
    })).toBe('create_version')

    // 39 days old, cadence = 60 → not stale → reuse_existing
    expect(selectResearchCaseAction({
      trigger: 'automated_discovery',
      latestCase: LATEST_V1,
      now: NOW,
      reanalysisCadenceDays: 60,
    })).toBe('reuse_existing')
  })
})
