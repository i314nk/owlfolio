import { createElement } from 'react'

import { ProviderStatusPanel } from '../../components/ProviderStatusPanel'
import { buildProviderStatusRows, buildModelRegistrySection } from '../../lib/providerStatus'

export default async function ProvidersPage() {
  const rows = await buildProviderStatusRows()
  // model-tiering: the registry resolves every role against the active run's provider/model. The
  // certified demo slice (mock-provider) is the safe default to render the role→model→tier map.
  const modelRegistry = buildModelRegistrySection({
    activeProviderId: 'mock-provider',
    activeModel: 'mock-buffett-munger-demo',
  })

  return createElement(ProviderStatusPanel, { rows, modelRegistry })
}
