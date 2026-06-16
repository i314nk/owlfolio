import type { CSSProperties } from 'react'
import Link from 'next/link'

import type { OwlfolioMode } from '@owlfolio/shared'

import { getOnboardingState } from '../../../lib/onboarding'
import { ResearchIntakeForm } from './ResearchIntakeForm'

const panelStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '1.25rem',
  boxShadow: '0 20px 45px rgba(0, 0, 0, 0.18)',
  color: '#f7f8ff',
  display: 'grid',
  gap: '1rem',
  padding: '1.5rem',
}

const ctaButtonStyle: CSSProperties = {
  alignItems: 'center',
  background: '#6366f1',
  borderRadius: '999px',
  color: '#ffffff',
  display: 'inline-flex',
  fontWeight: 800,
  justifyContent: 'center',
  padding: '0.7rem 1.05rem',
  textDecoration: 'none',
}

const secondaryLinkStyle: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '999px',
  color: '#cbd5e1',
  display: 'inline-flex',
  fontWeight: 800,
  padding: '0.65rem 1rem',
  textDecoration: 'none',
}

function getResearchBlockMessage(mode: OwlfolioMode, initialized: boolean): string {
  if (mode === 'unconfigured') {
    return 'No mode is chosen yet. Choose a mode to begin, then set up a personal-local workflow to record durable research cases.'
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
      <section aria-labelledby="research-intake-gate" style={panelStyle}>
        <p style={{ color: '#7c8cff', fontWeight: 800, letterSpacing: '0.08em', margin: 0 }}>OWLFOLIO</p>
        <h1 id="research-intake-gate" className="owl-page-title" style={{ lineHeight: 1.1, margin: '0.4rem 0 0' }}>
          Research intake unavailable in current mode
        </h1>
        <p style={{ color: '#cbd5e1', fontSize: '1rem', margin: '0' }}>{getResearchBlockMessage(state.config.mode, state.is_initialized)}</p>
        <ul style={{ color: '#9aa4b7', margin: '0.25rem 0 1rem', paddingLeft: '1.2rem' }}>
          <li>
            The research intake form requires personal credentials and a writable personal ledger so actions are auditable and replay-safe.
          </li>
          <li>Demo mode and uninitialized states are intentionally read-only for workflow previews.</li>
        </ul>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <Link className="owl-focusable" href="/onboarding" style={ctaButtonStyle}>
            Open onboarding and enable personal-local setup
          </Link>
          <Link className="owl-focusable" href="/settings/providers" style={secondaryLinkStyle}>
            Review provider readiness first
          </Link>
        </div>
      </section>
    </main>
  )
}
