import { createElement } from 'react'

import { ProviderStatusPanel } from '../../components/ProviderStatusPanel'
import { buildProviderStatusRows } from '../../lib/providerStatus'

export default async function ProvidersPage() {
  const rows = await buildProviderStatusRows()

  return createElement(ProviderStatusPanel, { rows })
}
