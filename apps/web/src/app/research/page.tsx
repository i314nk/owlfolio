import Link from 'next/link'

export default function ResearchLandingPage() {
  return (
    <main className="owl-route-frame owl-route-frame-narrow">
      <p className="owl-route-back-row">
        <Link className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </Link>
      </p>
      <section aria-labelledby="research-landing-title" className="owl-empty-state">
        <p className="owl-empty-state-kicker">Research workflow</p>
        <h1 id="research-landing-title" className="owl-empty-state-title">
          Research
        </h1>
        <p className="owl-empty-state-description">
          Start or resume source-backed company research before Owlfolio prepares watchlist drafts, portfolio review prompts, or audit evidence.
        </p>
        <div className="owl-empty-state-actions">
          <Link className="owl-button owl-button-primary owl-focusable" href="/research/new">
            Start research intake
          </Link>
          <Link className="owl-button owl-button-secondary owl-focusable" href="/learn">
            Learn workflow boundaries
          </Link>
        </div>
      </section>
    </main>
  )
}
