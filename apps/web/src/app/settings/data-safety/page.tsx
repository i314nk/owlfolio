import { createElement } from 'react'

import { DataSafetyPanel } from '../../../components/DataSafetyPanel'
import { getDataSafetyViewModel } from '../../../lib/dataSafety'

export const dynamic = 'force-dynamic'

export default async function DataSafetyPage() {
  const dataSafety = await getDataSafetyViewModel()

  return createElement(DataSafetyPanel, { dataSafety })
}
