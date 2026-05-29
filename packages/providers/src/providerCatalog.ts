import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import type { ProviderCapabilities } from './providerContract'

export type ProviderCatalogEntry = {
  provider_id: ProviderId
  label: string
  support_level: ProviderSupportLevel
  visible_in_onboarding: boolean
  description: string
  capabilities: ProviderCapabilities
}

const sharedCertifiedCapabilities: ProviderCapabilities = {
  'text-generation': 'native',
  'structured-output': 'native',
  'tool-function-calling': 'native',
  'streaming-observability': 'native',
  'multi-step-tool-loop': 'native',
}

const catalog: ProviderCatalogEntry[] = [
  {
    provider_id: 'mock-provider',
    label: 'Mock provider',
    support_level: 'certified',
    visible_in_onboarding: true,
    description: 'Deterministic demo provider for the audited Buffett-Munger vertical slice.',
    capabilities: {
      ...sharedCertifiedCapabilities,
    },
  },
  {
    provider_id: 'claude',
    label: 'Claude',
    support_level: 'certified',
    visible_in_onboarding: true,
    description: 'Primary real provider target for personal local mode.',
    capabilities: {
      ...sharedCertifiedCapabilities,
    },
  },
  {
    provider_id: 'openai',
    label: 'OpenAI',
    support_level: 'experimental',
    visible_in_onboarding: true,
    description: 'Planned provider path behind readiness and certification checks.',
    capabilities: {
      ...sharedCertifiedCapabilities,
    },
  },
]

export function getProviderCatalog(): ProviderCatalogEntry[] {
  return catalog.map((provider) => ({
    ...provider,
    capabilities: { ...provider.capabilities },
  }))
}
