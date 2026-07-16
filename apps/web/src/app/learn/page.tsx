import { OwlButtonLink, RouteHeader } from '../../components/designSystem'
import { LearnTabs } from '../../components/LearnTabs'

const linkRowStyle = { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.3rem' } as const

export default function LearnPage() {
  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <RouteHeader
        kicker="How it works"
        title="Learn"
        description="Owner’s Manual is a local-first investment research harness: grounded specialist agents propose evidence, deterministic code computes the numbers, and you author every decision. These tabs document the specs behind that harness — its strategy, its swarm, and the discipline that keeps it honest. This is an alpha; where something is experimental or setup-only, it says so."
      />
      <hr className="owl-rule" />

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
