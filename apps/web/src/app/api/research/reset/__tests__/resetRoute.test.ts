import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getOnboardingState = vi.fn()
const resetResearchLedgerState = vi.fn()

vi.mock('../../../../../lib/onboarding', () => ({
  getOnboardingState: () => getOnboardingState(),
}))

vi.mock('../../../../../lib/workflow', () => ({
  resetResearchLedgerState: (...args: unknown[]) => resetResearchLedgerState(...args),
}))

import { POST } from '../route'

function personalLocalState() {
  return { config: { mode: 'personal-local', provider: { provider_id: 'mock-provider' } }, is_initialized: true }
}

describe('POST /api/research/reset — gated destructive bulk reset', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    getOnboardingState.mockResolvedValue(personalLocalState())
    resetResearchLedgerState.mockResolvedValue({ cleared_events: 7 })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  it('404s and does NOT reset in normal personal-local operation (no dev flag)', async () => {
    delete process.env.OWLFOLIO_TEST_MODE
    delete process.env.OWLFOLIO_DEV_TOOLS

    const response = await POST()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(resetResearchLedgerState).not.toHaveBeenCalled()
  })

  it('resets and returns the cleared count under the playwright harness', async () => {
    process.env.OWLFOLIO_TEST_MODE = 'playwright'
    delete process.env.OWLFOLIO_DEV_TOOLS

    const response = await POST()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reset: true, cleared_events: 7 })
    expect(resetResearchLedgerState).toHaveBeenCalledTimes(1)
  })

  it('resets when the explicit dev opt-in OWLFOLIO_DEV_TOOLS=1 is set', async () => {
    delete process.env.OWLFOLIO_TEST_MODE
    process.env.OWLFOLIO_DEV_TOOLS = '1'

    const response = await POST()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reset: true, cleared_events: 7 })
    expect(resetResearchLedgerState).toHaveBeenCalledTimes(1)
  })

  it('returns 400 with the message when the reset throws', async () => {
    process.env.OWLFOLIO_DEV_TOOLS = '1'
    resetResearchLedgerState.mockRejectedValueOnce(new Error('disk gone'))

    const response = await POST()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'disk gone' })
  })
})
