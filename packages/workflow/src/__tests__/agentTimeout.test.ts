import { describe, it, expect } from 'vitest'
import { AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS, resolveAgentTimeoutMs } from '../researchSwarmSchemas'

describe('resolveAgentTimeoutMs', () => {
  it('defaults to 180_000 (3 min) when OWLFOLIO_AGENT_TIMEOUT_MS is unset', () => {
    // Lowered from 600s: a stalled codex call now costs ~3 min, not 10, before the retry recovers.
    expect(DEFAULT_AGENT_TIMEOUT_MS).toBe(180_000)
    expect(resolveAgentTimeoutMs(undefined)).toBe(180_000)
    expect(resolveAgentTimeoutMs('')).toBe(180_000)
  })

  it('honors a valid positive OWLFOLIO_AGENT_TIMEOUT_MS override', () => {
    expect(resolveAgentTimeoutMs('900000')).toBe(900_000)
    expect(resolveAgentTimeoutMs('120000')).toBe(120_000)
  })

  it('falls back to the 180_000 default on invalid/zero/negative override', () => {
    expect(resolveAgentTimeoutMs('0')).toBe(180_000)
    expect(resolveAgentTimeoutMs('-5')).toBe(180_000)
    expect(resolveAgentTimeoutMs('not-a-number')).toBe(180_000)
    expect(resolveAgentTimeoutMs('NaN')).toBe(180_000)
  })

  it('module-load AGENT_TIMEOUT_MS resolves to a positive value (default unless env override set)', () => {
    // When env is unset in the test runner, this is the 180s default; when set+valid, that wins.
    expect(AGENT_TIMEOUT_MS).toBeGreaterThan(0)
    expect(AGENT_TIMEOUT_MS).toBe(resolveAgentTimeoutMs(process.env['OWLFOLIO_AGENT_TIMEOUT_MS']))
  })
})
