export default function OnboardingPage() {
  return (
    <main style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)', color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
      <section style={{ margin: '0 auto', maxWidth: '920px' }}>
        <p style={{ color: '#047857', fontWeight: 800, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' }}>
          Owlfolio
        </p>
        <h1 style={{ fontSize: 'clamp(2.25rem, 5vw, 4.5rem)', lineHeight: 1, margin: '0.5rem 0 1rem' }}>
          Set up Owlfolio
        </h1>
        <p style={{ color: '#475569', fontSize: '1.15rem', maxWidth: '720px' }}>
          Start with the deterministic sample workflow before connecting personal local workflows.
        </p>

        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', margin: '2rem 0' }}>
          <article style={{ background: '#ffffff', border: '1px solid #bbf7d0', borderRadius: '1rem', boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)', padding: '1.25rem' }}>
            <p style={{ color: '#047857', fontSize: '0.8rem', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>
              Demo mode
            </p>
            <h2 style={{ fontSize: '1.5rem', margin: '0.5rem 0' }}>Deterministic vertical slice</h2>
            <p style={{ color: '#334155', margin: 0 }}>
              Provider: Mock provider / demo mode
            </p>
            <p style={{ color: '#334155', margin: '0.5rem 0 0' }}>
              Strategy: Buffett-Munger
            </p>
            <p style={{ color: '#334155', margin: '0.5rem 0 0' }}>
              Shariah: enabled by default
            </p>
            <a href="/" style={{ background: '#047857', borderRadius: '999px', color: '#ffffff', display: 'inline-flex', fontWeight: 800, marginTop: '1rem', padding: '0.7rem 1rem', textDecoration: 'none' }}>
              Start demo
            </a>
          </article>

          <article aria-disabled="true" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '1rem', opacity: 0.72, padding: '1.25rem' }}>
            <p style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>
              Personal local mode
            </p>
            <h2 style={{ fontSize: '1.5rem', margin: '0.5rem 0' }}>Coming later</h2>
            <p style={{ color: '#475569', margin: 0 }}>
              Personal local mode is disabled for this foundation slice while the audited demo workflow stabilizes.
            </p>
          </article>
        </div>
      </section>
    </main>
  )
}
