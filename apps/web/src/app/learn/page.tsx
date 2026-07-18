import { resolveLocale } from '@owlfolio/shared'

import { OwlButtonLink, RouteHeader } from '../../components/designSystem'
import { englishContentNote, t } from '../../lib/i18n'
import { getOnboardingState } from '../../lib/onboarding'
import { LearnTabs } from '../../components/LearnTabs'

const linkRowStyle = { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.3rem' } as const

export default async function LearnPage() {
  const locale = resolveLocale((await getOnboardingState()).config.language)
  const note = englishContentNote(locale)
  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <RouteHeader
        kicker={t(locale, 'ln_kicker')}
        title={t(locale, 'ln_title')}
        description={t(locale, 'ln_desc')}
      />
      <hr className="owl-rule" />
      {note === undefined ? null : (
        <p data-testid="english-content-note" dir="rtl" className="owl-row-helper" style={{ border: '1px solid var(--owl-color-border)', borderRadius: '0.6rem', margin: 0, padding: '0.6rem 0.8rem' }}>
          {note}
        </p>
      )}

      <LearnTabs />

      <section className="owl-section-card" id="providers" style={{ gap: 'var(--owl-space-3)' }}>
        <p className="owl-section-accent">Where to go next</p>
        <h2 className="owl-section-title">Provider readiness, the audit trail, and your data</h2>
        <p className="owl-body" style={{ margin: 0 }}>
          The specs above describe the design. What actually runs in this install depends on which providers are
          configured and certified. Readiness is not certification: a provider can have working credentials and still be
          experimental or fail-closed until a target-specific certification report exists. Every proposal, confirmation,
          and override is recorded in an append-only local ledger, and all data lives on your machine.
        </p>
        <div style={linkRowStyle}>
          <OwlButtonLink href="/settings/providers">Review provider states →</OwlButtonLink>
          <OwlButtonLink href="/strategy" variant="secondary">
            The full strategy method →
          </OwlButtonLink>
          <OwlButtonLink href="/audit" variant="secondary">
            View the audit trail →
          </OwlButtonLink>
          <OwlButtonLink href="/settings/data-safety" variant="secondary">
            Data safety and backup →
          </OwlButtonLink>
        </div>
      </section>
    </main>
  )
}
