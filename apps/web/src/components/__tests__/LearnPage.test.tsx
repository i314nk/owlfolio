import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('LearnPage source', () => {
  const pageSource = readFileSync('apps/web/src/app/learn/page.tsx', 'utf8')
  const tabsSource = readFileSync('apps/web/src/components/LearnTabs.tsx', 'utf8')

  it('routes the header chrome through the dictionary and keeps the english-content note (long-form pattern)', () => {
    expect(pageSource).toContain("t(locale, 'ln_kicker')")
    expect(pageSource).toContain("t(locale, 'ln_title')")
    expect(pageSource).toContain("t(locale, 'ln_desc')")
    expect(pageSource).toContain('englishContentNote')
  })

  it('claims no calibration file — post-mortems live in the ledger; calibration is a deferred pass', () => {
    expect(tabsSource).not.toContain('calibration file')
  })

  it('keeps the rebrand rules: no book mentions, no book rule-number vocabulary', () => {
    expect(tabsSource).not.toMatch(/the book\b/)
    expect(tabsSource).not.toMatch(/[Rr]ule \d/)
    expect(pageSource).not.toMatch(/the book\b/)
  })

  it('the Strategy & Valuation tab NAMES the strategy and enumerates its four pillars', () => {
    expect(tabsSource).toContain('Buffett 4-Pillar')
    expect(tabsSource).toContain('Pillar 1 — Understand the business')
    expect(tabsSource).toContain('Pillar 2 — Moat')
    expect(tabsSource).toContain('Pillar 3 — Management')
    expect(tabsSource).toContain('Pillar 4 — Value the business')
  })

  it('reflects the current app state — no retired-feature claims', () => {
    // SCALE-DOWN: onboarding carries no capital; sizing is removed by design, not "a later phase";
    // nothing binds buys (the harness never executes one).
    expect(tabsSource).not.toContain('model, capital')
    expect(tabsSource).not.toContain('a later phase')
    expect(tabsSource).not.toContain('15% deployment cap')
    // The CLI never writes config/credentials — three read/launch/diagnose commands.
    expect(tabsSource).not.toContain('reads and writes config')
    // Certification is optional (responsibility is the user's) — no fictional production gate.
    expect(tabsSource).not.toContain('Golden-set qualification')
    expect(tabsSource).not.toContain('reaches production only after')
    // No roadmap language (owner, 2026-07-18): the docs describe what IS, never what is deferred.
    expect(tabsSource).not.toMatch(/\bdeferred\b/i)
    expect(tabsSource).not.toContain('later slice')
    expect(tabsSource).not.toContain('no scheduler fires it yet')
    expect(tabsSource).not.toContain('future calibration')
  })

  it('the CLI tab teaches the rebranded launcher (owners-manual primary, owlfolio compat alias)', () => {
    expect(tabsSource).toContain('owners-manual ')
    expect(tabsSource).toContain('compat alias')
  })

  it('the source whitelist names only live lanes and only shipped source kinds', () => {
    // The risks lane is retired (historical dossiers only) and transcripts are not sourced.
    expect(tabsSource).not.toContain('risks may read anything')
    expect(tabsSource).not.toContain('transcripts')
  })

  it('the Judgment tab matches the mechanisms: base-rate burdens are FLAGGED (never auto-rejected)', () => {
    // Mechanism 3 flags base_rate_burden_unmet and surfaces it — synthesis does not reject.
    expect(tabsSource).not.toContain('Synthesis rejects inside-view')
    expect(tabsSource).toContain('never silently passed')
  })

  it('the hygiene checklists section is removed (owner 2026-07-18: no user-facing checklist exists)', () => {
    // The cognitive list was never presented anywhere; the business list survives only as invisible
    // audit provenance on the promote event. Docs must not describe an experience that does not exist.
    expect(tabsSource).not.toContain('Quality & bias hygiene')
    expect(tabsSource).not.toContain('CHECKLIST_PARAMS')
    const strategySource = readFileSync('apps/web/src/components/StrategyOverview.tsx', 'utf8')
    expect(strategySource).not.toContain('Quality & bias hygiene')
    expect(strategySource).not.toContain('CHECKLIST_PARAMS')
  })

  it('the Shariah tab documents the screening toggle honestly (fail-visible OFF)', () => {
    expect(tabsSource).toContain('Shariah screening')
    expect(tabsSource).toContain('GATE OFF')
    expect(tabsSource).toContain('DISABLED')
  })
})

describe('StrategyPage source', () => {
  const strategyPageSource = readFileSync('apps/web/src/app/strategy/page.tsx', 'utf8')

  it('claims no retired position sizing and no reverse-DCF-as-the-method in the metadata', () => {
    expect(strategyPageSource).not.toContain('position sizing')
    expect(strategyPageSource).not.toContain('reverse-DCF valuation')
  })
})
