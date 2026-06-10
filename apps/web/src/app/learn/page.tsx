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
        eyebrow="How it works"
        title="Learn"
        description="Owlfolio is a local-first investment workflow assistant. This page explains the key concepts so you can trust what you see and act with confidence."
      />

      <section className="owl-card" id="workflow">
        <p className="owl-card-eyebrow">Workflow overview</p>
        <h2>How a research case moves through the system</h2>
        <p className="owl-card-body">
          Every investment idea follows the same pipeline so nothing slips through without a record:
        </p>
        <ol>
          <li><strong>Research</strong> — Create a research case for a ticker. The provider runs a quick screen and a deep dive.</li>
          <li><strong>Quick screen</strong> — A fast pass against the Buffett-Munger quality criteria. You can approve automatically or review each result.</li>
          <li><strong>Deep dive</strong> — Full thesis, valuation, and Shariah check if enabled. You see the evidence before any decision is recorded.</li>
          <li><strong>Decision</strong> — You confirm, reject, or defer. Provider proposals are never auto-executed as investment actions.</li>
          <li><strong>Watchlist</strong> — Confirmed candidates land on the watchlist for ongoing monitoring. Changes require your explicit confirmation.</li>
          <li><strong>Holding</strong> — When you open a position, a separate holding event is recorded in the local ledger.</li>
        </ol>
      </section>

      <section className="owl-card" id="strategy-overview">
        <p className="owl-card-eyebrow">Investing approach</p>
        <h2>The Buffett-Munger strategy</h2>
        <p className="owl-card-body">
          Owlfolio runs the Buffett-Munger quality-and-margin-of-safety strategy as its default direction. The dedicated strategy page explains how the screen, thesis gates, and review cadence translate that philosophy into the research and watchlist pipeline.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.8rem' }}>
          <OwlButtonLink href="/strategy">The Buffett-Munger strategy in detail →</OwlButtonLink>
        </div>
      </section>

      <section className="owl-card" id="automation">
        <p className="owl-card-eyebrow">Automation boundaries</p>
        <h2>What changes automatically and what you confirm</h2>
        <p className="owl-card-body">
          Owlfolio moves research and monitoring work forward automatically, but every decision that affects your holdings, watchlist, or Shariah position requires your explicit confirmation. No investment action is executed on your behalf.
        </p>
        <ul>
          <li>Provider proposals are suggestions, not executed actions.</li>
          <li>Watchlist proposals and monitoring changes require your confirmation.</li>
          <li>Audit and evidence remain linked to each confirmation and override.</li>
        </ul>
      </section>

      <section className="owl-card" id="shariah">
        <p className="owl-card-eyebrow">Shariah policy</p>
        <h2>Shariah screening</h2>
        <p className="owl-card-body">
          Shariah-aware mode adds a structured compliance layer to every research case. Three things to know:
        </p>
        <ul>
          <li><strong>Business activity screen</strong> — Companies are checked against prohibited sectors (alcohol, tobacco, conventional finance, weapons, adult entertainment, pork). A match blocks the research case from proceeding without an explicit override.</li>
          <li><strong>Financial ratio screen</strong> — Debt-to-assets, interest-bearing income, and cash-to-market-cap ratios are checked against configurable thresholds (default: AAOIFI guidelines). A company can pass the activity screen and still fail on leverage.</li>
          <li><strong>CONDITIONAL status</strong> — A CONDITIONAL result means the company passes business activity but one or more financial ratios are borderline or unverified. You decide whether to accept it, override it, or defer pending cleaner data. Purification obligations are tracked separately as auditable ledger events.</li>
        </ul>
        <p className="owl-card-body">
          These screens are a local workflow aid — not a professional Shariah ruling or fatwa. Always consult a qualified Shariah adviser for personal or institutional compliance decisions.
        </p>
      </section>

      <section className="owl-card" id="audit">
        <p className="owl-card-eyebrow">Trust layer</p>
        <h2>Auditability and traceability</h2>
        <p className="owl-card-body">
          Every workflow signal is recorded in an append-only local ledger. Use the Audit page as the canonical trust view for proposals, user actions, and review outcomes.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.8rem' }}>
          <OwlButtonLink href="/audit">View the audit trail →</OwlButtonLink>
        </div>
      </section>

      <section className="owl-card" id="providers">
        <p className="owl-card-eyebrow">Provider context</p>
        <h2>Which providers can run research</h2>
        <p className="owl-card-body">
          Provider readiness, certification status, and allowed-use limits are all in one place.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.8rem' }}>
          <OwlButtonLink href="/providers">Review provider states →</OwlButtonLink>
        </div>
      </section>

      <section className="owl-card" id="fallback">
        <p className="owl-card-eyebrow">Data safety</p>
        <h2>Local data and backups</h2>
        <p className="owl-card-body">
          All data lives on your machine. Backup, restore, and credential handling details are on the Data Safety page.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.8rem' }}>
          <OwlButtonLink href="/settings/data-safety" variant="secondary">
            Data safety and backup details →
          </OwlButtonLink>
        </div>
      </section>
    </main>
  )
}
