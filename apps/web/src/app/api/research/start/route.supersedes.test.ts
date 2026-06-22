import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Isolate the supersedes-threading contract: mock every gate + the enqueue so the ONLY thing under test
// is that the route parses `supersedes_research_case_id` and passes it through to `enqueueResearchRun`.
// (The real-ledger integration behavior — readiness/onboarding/circle gates — is covered in route.test.ts.)
vi.mock('../../../../lib/onboarding', () => ({
  getOnboardingState: vi.fn(),
  getProviderReadinessSnapshot: vi.fn(),
}))
vi.mock('../../../../lib/onboardingGate', () => ({
  evaluateOnboardingGate: vi.fn(),
}))
vi.mock('../../../../lib/circleGate', () => ({
  evaluateCircleGate: vi.fn(),
}))
vi.mock('../../../../lib/workflow', () => ({
  enqueueResearchRun: vi.fn(),
}))

import { POST } from './route'
import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../lib/onboarding'
import { evaluateOnboardingGate } from '../../../../lib/onboardingGate'
import { enqueueResearchRun } from '../../../../lib/workflow'

const enqueueMock = vi.mocked(enqueueResearchRun)

function postBody(body: unknown): Request {
  return new Request('http://localhost/api/research/start', { method: 'POST', body: JSON.stringify(body) })
}

describe('/api/research/start — supersedes threading', () => {
  beforeEach(() => {
    // A ready, fully-onboarded personal-local state with the circle gate disabled, so the route reaches enqueue.
    vi.mocked(getOnboardingState).mockResolvedValue({
      is_initialized: true,
      config: {
        mode: 'personal-local',
        provider: { provider_id: 'mock-provider' },
        ledger_path: '/tmp/ledger.sqlite',
        source_ledger_path: '/tmp/source-ledger',
      },
    } as unknown as Awaited<ReturnType<typeof getOnboardingState>>)
    vi.mocked(getProviderReadinessSnapshot).mockResolvedValue({
      is_ready: true,
      provider_id: 'mock-provider',
      status_label: 'ready',
    } as unknown as Awaited<ReturnType<typeof getProviderReadinessSnapshot>>)
    vi.mocked(evaluateOnboardingGate).mockResolvedValue({
      is_complete: true,
      missing_items: [],
    } as unknown as Awaited<ReturnType<typeof evaluateOnboardingGate>>)
    enqueueMock.mockResolvedValue({ research_case_id: 'rc_new_123' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('threads supersedes_research_case_id through to enqueueResearchRun', async () => {
    const response = await POST(postBody({ ticker: 'MSFT', supersedes_research_case_id: 'rc_old_1' }))
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(payload).toEqual({ research_case_id: 'rc_new_123' })
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0]?.[1]).toMatchObject({ ticker: 'MSFT', supersedes_research_case_id: 'rc_old_1' })
  })

  it('still works with NO supersedes (plain new run) — no supersedes key passed', async () => {
    const response = await POST(postBody({ ticker: 'MSFT' }))

    expect(response.status).toBe(202)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const input = enqueueMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(input.ticker).toBe('MSFT')
    expect('supersedes_research_case_id' in input).toBe(false)
  })

  it('rejects an empty-string supersedes_research_case_id and does NOT enqueue', async () => {
    const response = await POST(postBody({ ticker: 'MSFT', supersedes_research_case_id: '   ' }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/supersedes_research_case_id must be a non-empty string/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects a non-string supersedes_research_case_id and does NOT enqueue', async () => {
    const response = await POST(postBody({ ticker: 'MSFT', supersedes_research_case_id: 42 }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/supersedes_research_case_id must be a non-empty string/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
