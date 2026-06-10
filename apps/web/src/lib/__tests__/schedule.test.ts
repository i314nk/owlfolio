import { describe, expect, it } from 'vitest'

import { humanizeCron, humanizeCronProse } from '../schedule'

describe('humanizeCron', () => {
  it('maps weekday cron to readable label', () => {
    expect(humanizeCron('0 7 * * 1-5')).toBe('Weekdays at 07:00')
  })

  it('maps quarterly cron to readable label', () => {
    expect(humanizeCron('0 8 1 */3 *')).toBe('Quarterly — 1st at 08:00')
  })

  it('maps daily cron to readable label', () => {
    expect(humanizeCron('0 7 * * *')).toBe('Daily at 07:00')
  })

  it('maps monthly cron to readable label', () => {
    expect(humanizeCron('0 8 1 * *')).toBe('Monthly — 1st at 08:00')
  })

  it('maps weekly cron to readable label', () => {
    expect(humanizeCron('0 0 * * 0')).toBe('Weekly')
  })

  it('maps annual cron to readable label', () => {
    expect(humanizeCron('0 0 1 1 *')).toBe('Annually')
  })

  it('returns generic fallback for unrecognised cron', () => {
    expect(humanizeCron('5 4 * * *')).toBe('On the worker schedule')
    expect(humanizeCron('0 9 * * 1')).toBe('On the worker schedule')
  })

  it('trims surrounding whitespace before matching', () => {
    expect(humanizeCron('  0 7 * * 1-5  ')).toBe('Weekdays at 07:00')
  })
})

describe('humanizeCronProse', () => {
  it('humanizes valuation refresh cadence prose', () => {
    const input = 'valuation refresh cadence 0 7 * * 1-5; accounting recalculates from ledger events on load'
    const result = humanizeCronProse(input)
    expect(result).toBe('Valuation refresh cadence: Weekdays at 07:00 — accounting recalculates from ledger events on load')
    expect(result).not.toContain('0 7 * * 1-5')
  })

  it('humanizes quarterly purification review cadence prose', () => {
    const input = 'quarterly purification review cadence 0 8 1 */3 *'
    const result = humanizeCronProse(input)
    expect(result).toBe('Quarterly purification review cadence: Quarterly — 1st at 08:00')
    expect(result).not.toContain('0 8 1 */3 *')
  })

  it('falls back to generic label when no known cron is embedded', () => {
    expect(humanizeCronProse('some unknown schedule 1 2 3 4 5')).toBe('On the worker schedule')
  })

  it('returns generic fallback for strings with no known cron and fewer than 5 tokens', () => {
    expect(humanizeCronProse('short string')).toBe('On the worker schedule')
  })
})
