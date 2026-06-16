import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// The mode route MUST delegate to the idempotent switchMode (S1) — it does NOT re-implement init.
const switchModeMock = vi.fn()
const getOnboardingStateMock = vi.fn()

vi.mock('../../../../lib/onboarding', () => ({
  switchMode: (...args: unknown[]) => switchModeMock(...args),
  getOnboardingState: (...args: unknown[]) => getOnboardingStateMock(...args),
}))

import { POST } from './route'

function jsonRequest(body: unknown): Request {
  return new Request('http://127.0.0.1:3000/api/onboarding/mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/onboarding/mode', () => {
  beforeEach(() => {
    switchModeMock.mockReset()
    getOnboardingStateMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('switches mode through the idempotent switchMode and returns the new config + initialized flag', async () => {
    const config = { mode: 'personal-local', provider: { provider_id: 'openrouter' }, ledger_path: '/x', initialized_at: '2026-01-01' }
    switchModeMock.mockResolvedValue(config)
    getOnboardingStateMock.mockResolvedValue({ config, is_initialized: true })

    const response = await POST(jsonRequest({ mode: 'personal-local' }))
    expect(response.status).toBe(200)
    const payload = await response.json()

    expect(switchModeMock).toHaveBeenCalledTimes(1)
    expect(switchModeMock).toHaveBeenCalledWith('personal-local')
    expect(payload.config).toEqual(config)
    expect(payload.is_initialized).toBe(true)
  })

  it('rejects an invalid mode without calling switchMode', async () => {
    const response = await POST(jsonRequest({ mode: 'not-a-mode' }))
    expect(response.status).toBe(400)
    expect(switchModeMock).not.toHaveBeenCalled()
  })
})
