import { redirect } from 'next/navigation'

import { getOnboardingState } from '../../../lib/onboarding'
import { ResearchIntakeForm } from './ResearchIntakeForm'

export default async function ResearchIntakePage() {
  const state = await getOnboardingState()

  if (!state.is_initialized || state.config.mode !== 'personal-local') {
    redirect('/')
  }

  return <ResearchIntakeForm />
}
