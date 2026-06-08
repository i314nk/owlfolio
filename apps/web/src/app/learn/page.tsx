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
        description="Owlfolio is an automation-first local-use candidate. Deep process details belong here so the primary screens stay action-oriented and honest about local/provider boundaries."
      />

      <section className="owl-card" id="automation">
        <p className="owl-card-eyebrow">Automation boundaries</p>
        <h2>What changes and what you confirm</h2>
        <p className="owl-card-body">
          Owlfolio uses the default Buffett-Munger strategy today and treats future selectable strategies as explicit, auditable posture decisions rather than certified claims. The research lane moves discovery to quick screen, deep dive, decision, watchlist, and holding state; automatic portfolio, accounting, and purification projections then stay bounded by local ledger evidence and user confirmations.
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
          Onboarding now stays focused on three plain-language actions: try demo mode, use ChatGPT/Codex, or use Gemini. Owlfolio does not run a production OAuth handoff today; it checks existing local sign-in state and keeps provider-backed workflow starts fail-closed when certification says the surface is not ready.
        </p>
        <ul>
          <li>Codex: run <code>codex login</code> outside Owlfolio, then return to onboarding so readiness can check the local Codex CLI session or configured token/API key.</li>
          <li>Gemini: run <code>gemini login</code> outside Owlfolio for setup/readiness discovery only. Workflow execution remains blocked until a Gemini CLI adapter and target-specific certification exist.</li>
          <li>Demo: use the mock provider to seed a deterministic local ledger without external credentials.</li>
          <li>Advanced direct API keys, Vertex/service-account lanes, and provider certification details belong on the Provider Status page and certification reports.</li>
        </ul>
      </section>

      <section className="owl-card" id="shariah">
        <p className="owl-card-eyebrow">Shariah policy</p>
        <h2>Shariah screening</h2>
        <p className="owl-card-body">
          Screening and purification cues stay attached to the workflow evidence. Owlfolio can prepare monitoring signals and policy notes, but confirmation and overrides remain explicit audit events.
        </p>
      </section>

      <section className="owl-card" id="fallback">
        <p className="owl-card-eyebrow">Data Safety boundaries</p>
        <h2>Local backup and restore</h2>
        <p className="owl-card-body">
          Data Safety boundaries are local and conservative: backup/restore and environment handoff are operator/manual today, credentials and provider auth homes stay out of backups, and no destructive web restore flow is available yet.
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
