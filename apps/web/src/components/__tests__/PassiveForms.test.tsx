import { describe, expect, it } from 'vitest'

import { submitPassiveContribution } from '../PassiveContributionForm'
import { submitPassivePlan } from '../PassiveSleevePanel'

// B7 — the passive-sleeve submit helpers (unit-tested without a DOM, mirroring the panel-helper
// convention): the plan POST hits /api/settings/passive, a contribution POST hits
// /api/passive/contributions, both surface the API's error message and refresh only on success.

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; init?: RequestInit }>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init !== undefined ? { init } : {}) })
    return { ok: status < 400, json: async () => body } as unknown as Response
  }) as unknown as typeof fetch
}

describe('submitPassivePlan (B7)', () => {
  it('POSTs the plan and refreshes on success', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let refreshed = 0
    const result = await submitPassivePlan({
      fetch: fakeFetch(200, { passive: {} }, calls),
      router: { refresh: () => { refreshed += 1 } },
      split: '80/20', monthlyAmount: 500, scheduleDay: 1,
    })
    expect(result.ok).toBe(true)
    expect(refreshed).toBe(1)
    expect(calls[0]?.url).toBe('/api/settings/passive')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ split: '80/20', monthly_amount: 500, schedule_day: 1 })
  })

  it('surfaces the API error message and does NOT refresh on 400', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let refreshed = 0
    const result = await submitPassivePlan({
      fetch: fakeFetch(400, { error: { message: 'schedule_day must be an integer between 1 and 28' } }, calls),
      router: { refresh: () => { refreshed += 1 } },
      split: '60/40', monthlyAmount: 500, scheduleDay: 31,
    })
    expect(result).toEqual({ ok: false, error: 'schedule_day must be an integer between 1 and 28' })
    expect(refreshed).toBe(0)
  })
})

describe('submitPassiveContribution (B7)', () => {
  it('POSTs the contribution (blank instrument omitted) and refreshes on success', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let refreshed = 0
    const result = await submitPassiveContribution({
      fetch: fakeFetch(200, { contribution_id: 'pc_1' }, calls),
      router: { refresh: () => { refreshed += 1 } },
      amount: 500, instrument: '  ',
    })
    expect(result.ok).toBe(true)
    expect(refreshed).toBe(1)
    expect(calls[0]?.url).toBe('/api/passive/contributions')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ amount: 500 })
  })

  it('surfaces the API error message on rejection', async () => {
    const result = await submitPassiveContribution({
      fetch: fakeFetch(400, { error: { message: 'amount must be a positive number' } }, []),
      router: { refresh: () => { throw new Error('must not refresh') } },
      amount: -5,
    })
    expect(result).toEqual({ ok: false, error: 'amount must be a positive number' })
  })
})
