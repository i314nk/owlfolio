import { describe, expect, it } from 'vitest'

import {
  buildModelRoleOverrideValue,
  isValidModelRoleId,
  parseModelRoleOverrideValue,
} from '../modelRoleConfig'

describe('isValidModelRoleId', () => {
  it('accepts every registry role and rejects anything else', () => {
    expect(isValidModelRoleId('synthesis')).toBe(true)
    expect(isValidModelRoleId('lane_moat')).toBe(true)
    expect(isValidModelRoleId('lane_moat_crosscheck')).toBe(true)
    expect(isValidModelRoleId('not_a_role')).toBe(false)
    expect(isValidModelRoleId('')).toBe(false)
  })
})

describe('buildModelRoleOverrideValue', () => {
  it('serializes provider + model + optional temp into provider:model@temp', () => {
    expect(buildModelRoleOverrideValue({ provider_id: 'openai', model: 'gpt-x', temperature: 0.1 }))
      .toBe('openai:gpt-x@0.1')
    expect(buildModelRoleOverrideValue({ provider_id: 'openai', model: 'gpt-x' }))
      .toBe('openai:gpt-x')
  })

  it('rejects a missing provider or model', () => {
    expect(() => buildModelRoleOverrideValue({ provider_id: '', model: 'gpt-x' })).toThrow()
    expect(() => buildModelRoleOverrideValue({ provider_id: 'openai', model: '' })).toThrow()
  })

  it('rejects an out-of-range or non-numeric temperature', () => {
    expect(() => buildModelRoleOverrideValue({ provider_id: 'openai', model: 'm', temperature: 5 })).toThrow()
    expect(() => buildModelRoleOverrideValue({ provider_id: 'openai', model: 'm', temperature: -1 })).toThrow()
    expect(() => buildModelRoleOverrideValue({ provider_id: 'openai', model: 'm', temperature: Number.NaN })).toThrow()
  })

  it('rejects provider/model containing the format delimiters or newlines', () => {
    expect(() => buildModelRoleOverrideValue({ provider_id: 'open:ai', model: 'm' })).toThrow()
    expect(() => buildModelRoleOverrideValue({ provider_id: 'openai', model: 'm@1' })).toThrow()
    expect(() => buildModelRoleOverrideValue({ provider_id: 'openai', model: 'm\nx' })).toThrow()
  })
})

describe('parseModelRoleOverrideValue', () => {
  it('round-trips a provider:model@temp string', () => {
    expect(parseModelRoleOverrideValue('openai:gpt-x@0.1')).toEqual({ provider_id: 'openai', model: 'gpt-x', temperature: 0.1 })
    expect(parseModelRoleOverrideValue('openai:gpt-x')).toEqual({ provider_id: 'openai', model: 'gpt-x' })
  })
})
