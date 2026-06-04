import { PageHeader, OwlButtonLink } from '../../components/designSystem'

export default function LearnPage() {
  return (
    <main className="owl-route-frame owl-route-frame-narrow">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
            Back to command center
        </a>
      </p>
      <PageHeader
        eyebrow="Operator documentation"
        title="Learn"
        description="Owlfolio is an automation-first operating cockpit. Deep process details belong here so the primary screens stay action-oriented."
      />

      <section className="owl-card" id="automation">
        <p className="owl-card-eyebrow">Automation boundaries</p>
        <h2>What changes and what you confirm</h2>
        <p className="owl-card-body">
          The platform surfaces automation proposals and reminders from providers, then pauses on state-changing steps until you review and confirm. You should expect concise evidence and a clear approval boundary, not a hidden background action.
        </p>
        <ul>
          <li>Provider proposals are suggestions, not executed actions.</li>
          <li>Watchlist proposals and monitoring changes require your confirmation.</li>
          <li>Audit and evidence remain linked to each confirmation and override.</li>
        </ul>
      </section>

      <section className="owl-card" id="audit">
        <p className="owl-card-eyebrow">Trust layer</p>
        <h2>Auditability and traceability</h2>
        <p className="owl-card-body">
          Every workflow signal is recorded in an append-only local ledger. Use the Audit page as the canonical trust view for proposals, user actions, and review outcomes.
        </p>
      </section>

      <section className="owl-card" id="providers">
        <p className="owl-card-eyebrow">Provider context</p>
        <h2>Provider readiness in one place</h2>
        <p className="owl-card-body">
          Provider certifications and adapter limits are shown in the app with local run-state. Deep certification details remain in provider docs and run records; primary workflow surfaces should still remain focused on next action and approval status.
        </p>
      </section>

      <section className="owl-card" id="shariah">
        <p className="owl-card-eyebrow">Shariah policy</p>
        <h2>Shariah screening</h2>
        <p className="owl-card-body">
          Screening and purification cues stay attached to the workflow evidence. Owlfolio can prepare monitoring signals and policy notes, but confirmation and overrides remain explicit audit events.
        </p>
      </section>

      <section className="owl-card" id="fallback">
        <p className="owl-card-eyebrow">Operator fallback</p>
        <h2>Local backup and restore</h2>
        <p className="owl-card-body">
          Backup/restore and environment handoff are operator/manual today. Keep explicit operator runbooks close at hand until a production-grade web restore flow exists.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '0.5rem', marginTop: '0.8rem' }}>
          <OwlButtonLink href="/onboarding" variant="secondary">
            Open onboarding and local setup
          </OwlButtonLink>
          <OwlButtonLink href="/providers">Review provider states</OwlButtonLink>
        </div>
      </section>
    </main>
  )
}
