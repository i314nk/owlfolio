import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'

import { ResearchLibrary } from '../ResearchLibrary'

function researchCase(overrides: Partial<ResearchCaseProjection> & Pick<ResearchCaseProjection, 'research_case_id'>): ResearchCaseProjection {
  return {
    version: 1,
    superseded: false,
    archived: false,
    stage: 'discovered',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('ResearchLibrary — company names on the cards', () => {
  it('renders "TICKER — Company Name" (title-cased) when the case recorded a registrant name', () => {
    const html = renderToStaticMarkup(createElement(ResearchLibrary, {
      cases: [{
        research_case_id: 'rc_v_001',
        ticker: 'V',
        entity_name: 'VISA INC.',
        stage: 'analysis_drafted',
        investment_verdict: 'WATCH',
        superseded: false,
        archived: false,
        version: 1,
        updated_at: '2026-07-10T00:00:00.000Z',
        created_at: '2026-07-10T00:00:00.000Z',
      } as never],
      mode: 'personal-local',
      selectedStrategyName: 'Buffett 4-Pillar',
    }))
    expect(html).toContain('— Visa Inc.')
  })

  it('keeps the legacy id line when no registrant name was recorded', () => {
    const html = renderToStaticMarkup(createElement(ResearchLibrary, {
      cases: [{
        research_case_id: 'rc_cost_001',
        ticker: 'COST',
        company_id: 'Costco Wholesale',
        stage: 'analysis_drafted',
        investment_verdict: 'WATCH',
        superseded: false,
        archived: false,
        version: 1,
        updated_at: '2026-07-10T00:00:00.000Z',
        created_at: '2026-07-10T00:00:00.000Z',
      } as never],
      mode: 'personal-local',
      selectedStrategyName: 'Buffett 4-Pillar',
    }))
    expect(html).toContain('Costco Wholesale')
    expect(html).not.toContain('— Costco')
  })
})

describe('ResearchLibrary', () => {
  it('renders the library header, the new-research action, and the live pipeline link', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [],
      }),
    )

    expect(html).toContain('Research library')
    expect(html).toContain('New research')
    expect(html).toContain('Manual ticker intake')
    expect(html).toContain('href="/research/new"')
    expect(html).toContain('href="/pipeline"')
    // The strategy chip carries the DISPLAY name — the persisted strategy_id must never leak.
    expect(html).toContain('Selected strategy: Buffett 4-Pillar')
    expect(html).not.toContain('buffett-munger')

    // The vital-signs summary band leads the page on the Fiduciary Briefing standard.
    expect(html).toContain('owl-ledger-line')
    expect(html).toContain('Cases studied')
  })

  it('shows an honest empty state when there are no cases', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [],
      }),
    )

    expect(html).toContain('No research yet — start with Manual ticker intake.')
    expect(html).not.toContain('Buy candidates')
    expect(html).not.toContain('Cases still moving')
  })

  it('renders a failed case under the Failed runs group with a FAILED chip (not "In progress")', () => {
    // The ADBE bug: a mid-run failure left the case in the "In progress" group forever. The projection
    // now stages it 'failed'; the library shows it honestly with its own group + chip.
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [
          researchCase({
            research_case_id: 'rc_adbe_failed',
            ticker: 'ADBE',
            stage: 'failed',
            run_failed_error_summary: 'synthesis stage failed after retry',
          }),
        ],
      }),
    )
    expect(html).toContain('Failed runs')
    expect(html).toContain('>FAILED<')
    expect(html).toContain('Run failed')
    expect(html).not.toContain('>IN PROGRESS<')
    expect(html).not.toContain('Cases still moving')
  })

  it('groups cases by verdict and renders dossier links with verdict chips', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [
          researchCase({
            research_case_id: 'rc_cost_1',
            ticker: 'COST',
            company_id: 'Costco Wholesale',
            stage: 'decision_drafted',
            decision: 'WATCH',
            moat: 'wide',
            shariah_status: 'conditional',
            updated_at: '2026-06-05T00:00:00.000Z',
          }),
          researchCase({
            research_case_id: 'rc_msft_1',
            ticker: 'MSFT',
            stage: 'holding',
            investment_verdict: 'BUY',
            updated_at: '2026-06-04T00:00:00.000Z',
          }),
          researchCase({
            research_case_id: 'rc_xyz_1',
            ticker: 'XYZ',
            stage: 'rejected',
            updated_at: '2026-06-03T00:00:00.000Z',
          }),
          researchCase({
            research_case_id: 'rc_abc_1',
            ticker: 'ABC',
            stage: 'deep_dive_started',
            updated_at: '2026-06-02T00:00:00.000Z',
          }),
        ],
      }),
    )

    expect(html).toContain('In progress')
    expect(html).toContain('Buy candidates')
    expect(html).toContain('Watch')
    expect(html).toContain('Avoided')

    expect(html).toContain('href="/research/rc_cost_1"')
    expect(html).toContain('href="/research/rc_msft_1"')
    expect(html).toContain('COST')
    expect(html).toContain('Costco Wholesale')

    expect(html).toContain('>BUY<')
    expect(html).toContain('>WATCH<')
    expect(html).toContain('>AVOID<')
    expect(html).toContain('>IN PROGRESS<')

    // verdict-relevant meta chips
    expect(html).toContain('wide')
    expect(html).toContain('conditional')
  })

  it('keeps only the latest non-superseded version per ticker', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [
          researchCase({
            research_case_id: 'rc_nvda_v1',
            ticker: 'NVDA',
            version: 1,
            superseded: true,
            stage: 'decision_drafted',
            decision: 'PASS',
          }),
          researchCase({
            research_case_id: 'rc_nvda_v2',
            ticker: 'NVDA',
            version: 2,
            superseded: false,
            stage: 'decision_drafted',
            decision: 'WATCH',
          }),
        ],
      }),
    )

    expect(html).toContain('href="/research/rc_nvda_v2"')
    expect(html).not.toContain('href="/research/rc_nvda_v1"')
    expect(html).toContain('v2')
  })

  it('hides an archived case from the active library, like superseded (option-b append-only archive)', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [
          researchCase({
            research_case_id: 'rc_live',
            ticker: 'LIVE',
            stage: 'decision_drafted',
            decision: 'WATCH',
          }),
          researchCase({
            research_case_id: 'rc_arch',
            ticker: 'ARCH',
            archived: true,
            stage: 'decision_drafted',
            decision: 'WATCH',
          }),
        ],
      }),
    )

    expect(html).toContain('href="/research/rc_live"')
    expect(html).not.toContain('href="/research/rc_arch"')
  })

  it('flags an older-engine run with a compact chip, and not current/pre-versioning runs', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [
          researchCase({
            research_case_id: 'rc_older',
            ticker: 'OLD',
            stage: 'decision_drafted',
            decision: 'WATCH',
            valuation: { judgment: { engine_version: 'engine-old/old' } },
          }),
          researchCase({
            research_case_id: 'rc_current',
            ticker: 'CUR',
            stage: 'decision_drafted',
            decision: 'BUY',
            valuation: { judgment: { engine_version: ENGINE_VERSION } },
          }),
          researchCase({
            research_case_id: 'rc_legacy',
            ticker: 'LEG',
            stage: 'decision_drafted',
            decision: 'PASS',
          }),
        ],
      }),
    )

    // The older run is visibly flagged; current + pre-versioning runs are not.
    expect(html).toContain('data-testid="older-engine-chip"')
    expect(html).toContain('older engine')
    expect((html.match(/older-engine-chip/g) ?? []).length).toBe(1)
  })

  it('never renders an internal company_<ticker> slug where the company name belongs', () => {
    // The COST bug: legacy cases carry company_id slugs like "company_cost" — a machine id, not a
    // name. When no entity_name is recorded (and the SEC backfill is offline), the card shows just
    // the ticker instead of leaking the slug.
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [
          researchCase({
            research_case_id: 'rc_cost_slug',
            ticker: 'COST',
            company_id: 'company_cost',
            stage: 'analysis_drafted',
            investment_verdict: 'WATCH',
          }),
        ],
      }),
    )
    expect(html).toContain('COST')
    expect(html).not.toContain('company_cost')
  })

  it('replaces a placeholder or blank thesis summary with an honest fallback', () => {
    // The GOOG bug: the model stamps "Will formulate after reading source material" before sources
    // are read; a terminal card must never present that draft placeholder as the recorded thesis.
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [
          researchCase({
            research_case_id: 'rc_goog_placeholder',
            ticker: 'GOOG',
            stage: 'decision_drafted',
            decision: 'WATCH',
            thesis_summary: 'Will formulate after reading source material',
          }),
          researchCase({
            research_case_id: 'rc_blank_thesis',
            ticker: 'BLNK',
            stage: 'decision_drafted',
            decision: 'PASS',
            thesis_summary: '   ',
          }),
        ],
      }),
    )
    expect(html).not.toContain('Will formulate')
    expect((html.match(/No thesis summary recorded/g) ?? []).length).toBe(2)
  })

  it('keeps a real thesis summary untouched', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [
          researchCase({
            research_case_id: 'rc_msft_thesis',
            ticker: 'MSFT',
            stage: 'decision_drafted',
            decision: 'BUY',
            thesis_summary: 'Microsoft is a compounding fortress anchored by enterprise switching costs.',
          }),
        ],
      }),
    )
    expect(html).toContain('Microsoft is a compounding fortress')
    expect(html).not.toContain('No thesis summary recorded')
  })

  it('labels the in-progress vital-signs stat "In progress", not "Open files"', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [],
      }),
    )
    expect(html).toContain('owl-ledger-label">In progress')
    expect(html).not.toContain('owl-ledger-label">Open files')
  })

  it('renders the page chrome in Arabic when locale is ar (case data stays as recorded)', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        locale: 'ar',
        cases: [
          researchCase({
            research_case_id: 'rc_msft_ar',
            ticker: 'MSFT',
            stage: 'decision_drafted',
            decision: 'BUY',
          }),
        ],
      }),
    )
    // Header + stats + group chrome follow the locale…
    expect(html).toContain('مكتبة البحث')
    expect(html).toContain('الأرشيف')
    expect(html).toContain('قيد التنفيذ')
    expect(html).toContain('مرشحات الشراء')
    expect(html).not.toContain('Research library')
    expect(html).not.toContain('Buy candidates')
    // …while recorded case data does not.
    expect(html).toContain('MSFT')
  })

  it('defaults the page chrome to English when no locale is given', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyName: 'Buffett 4-Pillar',
        cases: [],
      }),
    )
    expect(html).toContain('Research library')
    expect(html).toContain('The archive')
    expect(html).not.toContain('مكتبة البحث')
  })
})
