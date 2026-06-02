import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import { ClaudeCliProvider } from './claudeCliProvider'
import { MockProvider } from './mockProvider'
import { OpenAICodexCliProvider } from './openaiCodexCliProvider'
import type { ProviderCapabilities } from './providerContract'

export type ProviderCatalogEntry = {
  provider_id: ProviderId
  label: string
  support_level: ProviderSupportLevel
  visible_in_onboarding: boolean
  description: string
  capabilities: ProviderCapabilities
}

const mockCapabilities = new MockProvider().capabilities
const claudeCapabilities = new ClaudeCliProvider().capabilities
const openAICapabilities = new OpenAICodexCliProvider().capabilities

const catalog: ProviderCatalogEntry[] = [
  {
    provider_id: 'mock-provider',
    label: 'Mock provider',
    support_level: 'certified',
    visible_in_onboarding: true,
    description: 'Deterministic demo provider for the audited Buffett-Munger vertical slice.',
    capabilities: {
      ...mockCapabilities,
    },
  },
  {
    provider_id: 'claude',
    label: 'Claude',
    support_level: 'experimental',
    visible_in_onboarding: true,
    description: 'CLI-backed real provider path behind readiness and certification checks.',
    capabilities: {
      ...claudeCapabilities,
    },
  },
  {
    provider_id: 'openai',
    label: 'OpenAI',
    support_level: 'experimental',
    visible_in_onboarding: true,
    description: 'CLI-backed Codex provider path behind readiness and certification checks.',
    capabilities: {
      ...openAICapabilities,
    },
  },
]

export function getProviderCatalog(): ProviderCatalogEntry[] {
  return catalog.map((provider) => ({
    ...provider,
    capabilities: { ...provider.capabilities },
  }))
}
