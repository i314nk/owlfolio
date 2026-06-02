import { describe, expect, it } from 'vitest'

import { ClaudeCliProvider } from '../claudeCliProvider'
import { getProviderCatalog } from '../providerCatalog'
import { MockProvider } from '../mockProvider'
import { OpenAICodexCliProvider } from '../openaiCodexCliProvider'

function catalogEntry(providerId: string) {
  const entry = getProviderCatalog().find((provider) => provider.provider_id === providerId)
  if (entry === undefined) {
    throw new Error(`Missing provider catalog entry: ${providerId}`)
  }
  return entry
}

describe('provider catalog support semantics', () => {
  it('does not advertise capabilities above the resolved adapter implementation', () => {
    expect(catalogEntry('mock-provider').capabilities).toEqual(new MockProvider().capabilities)
    expect(catalogEntry('claude').capabilities).toEqual(new ClaudeCliProvider().capabilities)
    expect(catalogEntry('openai').capabilities).toEqual(new OpenAICodexCliProvider().capabilities)
  })

  it('keeps CLI-backed real providers experimental until certification proves full workflow parity', () => {
    expect(catalogEntry('mock-provider')).toMatchObject({ support_level: 'certified' })
    expect(catalogEntry('claude')).toMatchObject({ support_level: 'experimental' })
    expect(catalogEntry('openai')).toMatchObject({ support_level: 'experimental' })
  })
})
