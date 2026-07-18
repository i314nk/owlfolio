import { createElement } from 'react'


import { DataSafetyPanel } from '../../../components/DataSafetyPanel'
import { getDataSafetyViewModel } from '../../../lib/dataSafety'
import { isResearchResetEnabled } from '../../../lib/devTools'
import { getOnboardingState } from '../../../lib/onboarding'

export const dynamic = 'force-dynamic'

export default async function DataSafetyPage() {
  const [dataSafety, state] = await Promise.all([
    getDataSafetyViewModel(),
    getOnboardingState(),
  ])

  const bulkResetEnabled = isResearchResetEnabled({ env: process.env, mode: state.config.mode })

  return createElement(DataSafetyPanel, { dataSafety, bulkResetEnabled })
}
