import { describe, expect, it } from 'vitest'

import { autoTierAssignmentToRoleOverrides } from '../autoTierAssignment'
import { resolveModelForRole } from '../modelRegistry'

describe('autoTierAssignmentToRoleOverrides — the default layer beneath pins', () => {
  const assignments = {
    synthesis: { provider_id: 'claude', model: 'claude-opus-4-8', tier: 'T1' as const },
    monitors: { provider_id: 'claude', model: 'claude-haiku-4-5', tier: 'T3' as const },
  }

  it('maps each auto assignment to a provider/model override (no temperature — registry owns that)', () => {
    const overrides = autoTierAssignmentToRoleOverrides(assignments)
    expect(overrides.synthesis).toEqual({ provider_id: 'claude', model: 'claude-opus-4-8' })
    expect(overrides.monitors).toEqual({ provider_id: 'claude', model: 'claude-haiku-4-5' })
    expect('temperature' in (overrides.synthesis ?? {})).toBe(false)
  })

  it('auto fills an unpinned role in the resolver', () => {
    const overrides = autoTierAssignmentToRoleOverrides(assignments)
    const resolved = resolveModelForRole('synthesis', {
      fallbackProviderId: 'mock-provider',
      fallbackModel: 'mock-demo',
      overrides,
      env: {},
    })
    expect(resolved.provider_id).toBe('claude')
    expect(resolved.model).toBe('claude-opus-4-8')
  })

  it('a PIN (env override) WINS over the auto default', () => {
    const overrides = autoTierAssignmentToRoleOverrides(assignments)
    const resolved = resolveModelForRole('synthesis', {
      fallbackProviderId: 'mock-provider',
      fallbackModel: 'mock-demo',
      overrides,
      // The user pinned synthesis onto a different provider/model via the env file.
      env: { OWLFOLIO_MODEL_ROLE_SYNTHESIS: 'openai:gpt-5.5' },
    })
    expect(resolved.provider_id).toBe('openai')
    expect(resolved.model).toBe('gpt-5.5')
  })
})
