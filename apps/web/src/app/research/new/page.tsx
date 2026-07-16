import Link from 'next/link'

import type { OwlfolioMode } from '@owlfolio/shared'

import { getOnboardingState } from '../../../lib/onboarding'
import { ResearchIntakeForm } from './ResearchIntakeForm'

function getResearchBlockMessage(mode: OwlfolioMode, initialized: boolean): string {
  if (mode === 'unconfigured') {
    return 'This workspace is not set up yet. Connect a provider to set up a personal-local workflow and record durable research cases.'
  }

  if (mode === 'personal-local' && !initialized) {
    return 'Personal-local mode is configured, but your workflow is not initialized yet.'
  }

  return `Research intake is intentionally gated to personal-local mode to keep cases durable, auditable, and user-owned. Current state: ${mode}.`
}

export default async function ResearchIntakePage() {
  const state = await getOnboardingState()

  if (state.is_initialized && state.config.mode === 'personal-local') {
    return <ResearchIntakeForm />
  }

  return (
    <main className="owl-route-frame owl-route-frame-narrow">
      <p className="owl-route-back-row">
        <Link className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </Link>
      </p>
      <section aria-labelledby="research-intake-gate" className="owl-section-card" style={{ gap: 'var(--owl-space-3)' }}>
        <p className="owl-section-accent" style={{ margin: 0 }}>
          Research intake
        </p>
        <h1 id="research-intake-gate" className="owl-page-title" style={{ lineHeight: 1.1, margin: 0 }}>
          Research intake unavailable in current mode
        </h1>
        <p className="owl-row-helper" style={{ margin: 0 }}>{getResearchBlockMessage(state.config.mode, state.is_initialized)}</p>
        <ul className="owl-row-helper" style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>
            The research intake form requires personal credentials and a writable personal ledger so actions are auditable and replay-safe.
          </li>
          <li>Uninitialized states are intentionally read-only for workflow previews.</li>
        </ul>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <Link className="owl-button owl-button-primary owl-focusable" href="/settings/providers">
            Open setup and enable personal-local mode
          </Link>
        </div>
      </section>
    </main>
  )
}
