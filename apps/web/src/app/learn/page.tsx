import type { ReactNode } from 'react'

import { OwlButtonLink, RouteHeader } from '../../components/designSystem'

const stepStyle = { color: 'var(--owl-color-muted)', lineHeight: 1.55, margin: 0 } as const
const listStyle = { display: 'grid', gap: '0.55rem', margin: 0, paddingLeft: '1.2rem' } as const
const linkRowStyle = { display: 'flex', justifyContent: 'flex-start', marginTop: '0.3rem' } as const

function Section({ id, accent, title, children }: { id: string; accent: string; title: string; children: ReactNode }) {
  return (
    <section className="owl-section-card" id={id} style={{ gap: 'var(--owl-space-3)' }}>
      <p className="owl-section-accent">{accent}</p>
      <h2 className="owl-section-title">{title}</h2>
      {children}
    </section>
  )
}

export default function LearnPage() {
  return (
    <main className="owl-route-frame owl-route-frame-narrow">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          Back to command center
        </a>
      </p>
      <RouteHeader
        kicker="How it works"
        title="Learn"
        description="Owlfolio is a local-first investment workflow assistant — an agent that researches under a value discipline and hands every decision to you. This page explains its strategy and the path from idea to decision, so you can trust what you see and act with confidence."
      />
      <hr className="owl-rule" />

      <Section id="workflow" accent="Workflow overview" title="How a research case moves from idea to decision">
        <p className="owl-body">
          Every investment idea follows the same pipeline so nothing reaches your portfolio without a record and a deliberate confirmation:
        </p>
        <ol style={listStyle}>
          <li style={stepStyle}><strong>Research</strong> — Open a research case for a ticker. Your agent runs a quick screen and a deep dive against the value discipline.</li>
          <li style={stepStyle}><strong>Quick screen</strong> — A fast pass against the Buffett-Munger quality criteria. You can approve automatically or review each result.</li>
          <li style={stepStyle}><strong>Deep dive</strong> — Full thesis, valuation, and Shariah check if enabled. You see the evidence before any decision is recorded.</li>
          <li style={stepStyle}><strong>Decision</strong> — You confirm, reject, or defer. Provider proposals are never auto-executed as investment actions.</li>
          <li style={stepStyle}><strong>Watchlist</strong> — Confirmed candidates land on the watchlist for ongoing monitoring. Changes require your explicit confirmation.</li>
          <li style={stepStyle}><strong>Holding</strong> — When you open a position, a separate holding event is recorded in the local ledger.</li>
        </ol>
      </Section>

      <Section id="strategy-overview" accent="Investing approach" title="The Buffett-Munger strategy">
        <p className="owl-body">
          Owlfolio runs the Buffett-Munger quality-and-margin-of-safety strategy as its default direction. The dedicated strategy page explains how the screen, thesis gates, and review cadence translate that philosophy into the research and watchlist pipeline.
        </p>
        <div style={linkRowStyle}>
          <OwlButtonLink href="/strategy">The Buffett-Munger strategy in detail →</OwlButtonLink>
        </div>
      </Section>

      <Section id="automation" accent="Automation boundaries" title="What changes automatically and what you confirm">
        <p className="owl-body">
          Owlfolio moves research and monitoring work forward automatically, but every decision that affects your holdings, watchlist, or Shariah position requires your explicit confirmation. No investment action is executed on your behalf.
        </p>
        <ul style={listStyle}>
          <li style={stepStyle}>Research and quick-screen passes run automatically once you open a case.</li>
          <li style={stepStyle}>Provider proposals are suggestions, not executed actions.</li>
          <li style={stepStyle}>Watchlist confirmations, holding opens, and monitoring changes wait for you.</li>
          <li style={stepStyle}>Audit and evidence stay linked to each confirmation and override.</li>
        </ul>
      </Section>

      <Section id="audit" accent="Trust layer" title="Auditability and traceability">
        <p className="owl-body">
          Every workflow signal — provider proposals, your confirmations and overrides, and review outcomes — is recorded in an append-only local ledger. Each proposal carries its grounded evidence and source references so a decision can always be traced back to what informed it. The Audit page is the canonical trust view.
        </p>
        <div style={linkRowStyle}>
          <OwlButtonLink href="/audit">View the audit trail →</OwlButtonLink>
        </div>
      </Section>

      <Section id="shariah" accent="Shariah policy" title="Shariah screening">
        <p className="owl-body">
          Shariah-aware mode adds a structured compliance layer to every research case. Three things to know:
        </p>
        <ul style={listStyle}>
          <li style={stepStyle}><strong>Business activity screen</strong> — Companies are checked against prohibited sectors (alcohol, tobacco, conventional finance, weapons, adult entertainment, pork). A match blocks the research case from proceeding without an explicit override.</li>
          <li style={stepStyle}><strong>Financial ratio screen</strong> — Debt-to-assets, interest-bearing income, and cash-to-market-cap ratios are checked against configurable thresholds (default: AAOIFI guidelines). A company can pass the activity screen and still fail on leverage.</li>
          <li style={stepStyle}><strong>CONDITIONAL status</strong> — A CONDITIONAL result means the company passes business activity but one or more financial ratios are borderline or unverified. You decide whether to accept it, override it, or defer pending cleaner data. Purification obligations are tracked separately as auditable ledger events.</li>
        </ul>
        <p className="owl-body">
          These screens are a local workflow aid — not a professional Shariah ruling or fatwa. Always consult a qualified Shariah adviser for personal or institutional compliance decisions.
        </p>
      </Section>

      <Section id="providers" accent="Provider context" title="Which providers can run research">
        <p className="owl-body">
          Provider readiness, certification status, and allowed-use limits live in one place. Readiness is not certification: a provider can have working credentials and still be experimental or fail-closed until a target-specific certification report exists.
        </p>
        <div style={linkRowStyle}>
          <OwlButtonLink href="/providers">Review provider states →</OwlButtonLink>
        </div>
      </Section>

      <Section id="fallback" accent="Data safety" title="Where your data lives">
        <p className="owl-body">
          All data lives on your machine. Backups carry your investment ledgers and source evidence but never credentials or API keys. The Data Safety page shows the full privacy boundary, the current inventory snapshot, and the honest, operator-only restore posture.
        </p>
        <div style={linkRowStyle}>
          <OwlButtonLink href="/settings/data-safety" variant="secondary">
            Data safety and backup details →
          </OwlButtonLink>
        </div>
      </Section>
    </main>
  )
}
