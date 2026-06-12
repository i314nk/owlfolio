import { describe, expect, it } from 'vitest'

import {
  DATA_POSTURE_POLICY,
  resolveDataPosture,
} from '../dataPosturePolicy'

describe('dataPosturePolicy — owner-attested, versioned, per-route', () => {
  it('is versioned and dated (an auditable, owner-attested policy, not a hardcoded guess)', () => {
    expect(DATA_POSTURE_POLICY.version).toMatch(/^data-posture-/)
    expect(DATA_POSTURE_POLICY.attested_at).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(DATA_POSTURE_POLICY.attested_by).toBe('owner')
  })

  it('routes OpenRouter DeepSeek to ZDR-routing-enforced (owner account setting)', () => {
    const posture = resolveDataPosture('openrouter-api', 'deepseek/deepseek-r1')
    expect(posture.retention_or_zdr_status).toBe('zdr_routing_enforced')
    expect(posture.data_policy_source).toBe('owner_attested_account_policy')
    expect(posture.attested).toBe(true)
    // The note must be honest: an owner ACCOUNT CONFIGURATION, not a contractual verification.
    expect(posture.note.toLowerCase()).toContain('owner-attested')
    expect(posture.note.toLowerCase()).toContain('zdr')
  })

  it('routes OpenRouter Anthropic/OpenAI/Google frontier models to vendor-standard no-training terms', () => {
    for (const model of ['anthropic/claude-opus-4.8', 'openai/gpt-5.5', 'google/gemini-2.5-pro']) {
      const posture = resolveDataPosture('openrouter-api', model)
      expect(posture.retention_or_zdr_status).toBe('vendor_standard_no_training_terms')
      expect(posture.data_policy_source).toBe('owner_attested_account_policy')
      expect(posture.attested).toBe(true)
      expect(posture.note.toLowerCase()).toContain('abuse-monitoring')
    }
  })

  it('treats any OTHER OpenRouter route as ZDR-enforced (owner attests ZDR-only for all non-frontier models)', () => {
    const posture = resolveDataPosture('openrouter-api', 'some/non-frontier-model')
    expect(posture.attested).toBe(true)
    expect(posture.retention_or_zdr_status).toBe('zdr_routing_enforced')
  })

  it('falls back to fail-closed for an unlisted provider surface', () => {
    const posture = resolveDataPosture('qwen-dashscope-api', 'qwen-max')
    expect(posture.attested).toBe(false)
    expect(posture.retention_or_zdr_status).toBe('not_verified')
  })
})
