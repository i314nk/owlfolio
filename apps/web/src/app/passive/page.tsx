// SCALE-DOWN S4 (owner-locked 2026-07-13): the passive page is INFORMATIVE ONLY. The contribution
// tracker is removed (user-input accounting — the class the scale-down retired); what remains is the
// passive foundation as pedagogy: keep market exposure via broad ETFs, contribute on a schedule,
// never sell the sleeve — plus named Shariah-compliant ETF candidates, clearly labeled educational
// content, not advice. Nothing on this page reads or writes the ledger.
import { resolveLocale } from '@owlfolio/shared'

import { RouteHeader } from '../../components/designSystem'
import { englishContentNote, t } from '../../lib/i18n'
import { getOnboardingState } from '../../lib/onboarding'

export const dynamic = 'force-dynamic'

// Plain principles — no book rule-number vocabulary (rebrand rule; the owner adds the credit later).
const PRINCIPLES = [
  {
    title: 'Own the market first',
    body: 'Before any single business, keep broad market exposure through a low-cost index ETF. The passive sleeve is the foundation the concentrated Buffett 4-Pillar sleeve stands on — it guarantees you participate in the market’s compounding even when no wonderful business trades at a margin of safety.',
  },
  {
    title: 'Contribute on a schedule, not a feeling',
    body: 'A fixed monthly contribution (dollar-cost averaging) removes timing judgment entirely. The schedule is the discipline: the same amount, the same day, regardless of headlines or prices.',
  },
  {
    title: 'Never sell the sleeve',
    body: 'The passive sleeve has no sell rule because it has no sell decision. Withdrawals are a retirement-planning question, not an investing one. Volatility is the admission price of the equity premium.',
  },
]

// Named candidates — EDUCATIONAL examples of Shariah-screened broad-market ETFs, not recommendations
// to buy any specific fund. Screens, fees, and holdings change: verify the fund's own current
// prospectus + Shariah certification before acting.
const ETFS = [
  { ticker: 'SPUS', name: 'SP Funds S&P 500 Sharia Industry Exclusions ETF', note: 'US large-cap; S&P 500 screened by AAOIFI-based exclusions.' },
  { ticker: 'HLAL', name: 'Wahed FTSE USA Shariah ETF', note: 'US broad market; FTSE Shariah screens.' },
  { ticker: 'SPWO', name: 'SP Funds S&P World ETF', note: 'Global (including non-US) Shariah-screened exposure.' },
  { ticker: 'ISDW / ISDU', name: 'iShares MSCI World / USA Islamic UCITS ETFs', note: 'UCITS wrappers for non-US investors; MSCI Islamic screens.' },
  { ticker: 'SPSK', name: 'SP Funds Dow Jones Global Sukuk ETF', note: 'The fixed-income-like sleeve: sukuk, not bonds.' },
]

export default async function PassivePage() {
  const locale = resolveLocale((await getOnboardingState()).config.language)
  const note = englishContentNote(locale)
  return (
    <main className="owl-route-frame">
      <RouteHeader
        kicker={t(locale, 'ps_kicker')}
        title={t(locale, 'ps_title')}
        description={t(locale, 'ps_desc')}
      />
      <hr className="owl-rule" />
      {note === undefined ? null : (
        <p data-testid="english-content-note" dir="rtl" className="owl-row-helper" style={{ border: '1px solid var(--owl-color-border)', borderRadius: '0.6rem', margin: '1rem 0 0', padding: '0.6rem 0.8rem' }}>
          {note}
        </p>
      )}

      <section className="owl-section-card" aria-label="The passive principles">
        <p className="owl-section-accent">The passive foundation</p>
        <div style={{ display: 'grid', gap: '0.9rem', marginTop: '0.6rem' }}>
          {PRINCIPLES.map((principle) => (
            <div key={principle.title}>
              <p style={{ color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', fontWeight: 700, margin: 0 }}>{principle.title}</p>
              <p style={{ color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: '0.2rem 0 0' }}>{principle.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="owl-section-card" aria-label="Shariah-compliant ETF candidates">
        <p className="owl-section-accent">Shariah-compliant ETF candidates</p>
        <p style={{ color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0.4rem 0 0.8rem' }}>
          Named examples of Shariah-screened broad-market funds — a starting point for your own research, not a recommendation.
        </p>
        <div style={{ display: 'grid', gap: '0.7rem' }}>
          {ETFS.map((etf) => (
            <div key={etf.ticker} style={{ background: 'var(--owl-color-panel-elevated)', border: '1px solid var(--owl-color-border)', borderRadius: '0.7rem', padding: '0.7rem 0.9rem' }}>
              <p style={{ color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', fontWeight: 800, margin: 0 }}>{etf.ticker}</p>
              <p style={{ color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', margin: '0.15rem 0 0' }}>{etf.name}</p>
              <p style={{ color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0.15rem 0 0' }}>{etf.note}</p>
            </div>
          ))}
        </div>
        <p style={{ color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0.9rem 0 0' }}>
          Know the trade-off: Shariah-screened ETFs are, by construction, less diversified than their conventional counterparts. The screens exclude entire sectors (conventional banks, insurers, highly leveraged businesses), so these funds hold fewer names, carry heavier sector tilts, and can deviate from the broad market in both directions.
        </p>
        <p style={{ color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', lineHeight: 1.5, margin: '0.9rem 0 0' }}>
          EDUCATIONAL CONTENT, NOT ADVICE. Screens, fees, holdings, and Shariah certifications change — verify each fund&rsquo;s current prospectus and certification yourself before investing. Owner’s Manual records nothing about your passive holdings.
        </p>
      </section>
    </main>
  )
}
