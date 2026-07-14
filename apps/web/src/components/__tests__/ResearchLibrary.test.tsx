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
      selectedStrategyLabel: 'Selected strategy: buffett-munger',
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
      selectedStrategyLabel: 'Selected strategy: buffett-munger',
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
        selectedStrategyLabel: 'Selected strategy: buffett-munger',
        cases: [],
      }),
    )

    expect(html).toContain('Research library')
    expect(html).toContain('New research')
    expect(html).toContain('Manual ticker intake')
    expect(html).toContain('href="/research/new"')
    expect(html).toContain('href="/pipeline"')
    expect(html).toContain('Selected strategy: buffett-munger')

    // The vital-signs summary band leads the page on the Fiduciary Briefing standard.
    expect(html).toContain('owl-ledger-line')
    expect(html).toContain('Cases studied')
  })

  it('shows an honest empty state when there are no cases', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyLabel: 'Selected strategy: buffett-munger',
        cases: [],
      }),
    )

    expect(html).toContain('No research yet — start with Manual ticker intake.')
    expect(html).not.toContain('Buy candidates')
    expect(html).not.toContain('In progress')
  })

  it('renders a failed case under the Failed runs group with a FAILED chip (not "In progress")', () => {
    // The ADBE bug: a mid-run failure left the case in the "In progress" group forever. The projection
    // now stages it 'failed'; the library shows it honestly with its own group + chip.
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyLabel: 'Selected strategy: buffett-munger',
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
    expect(html).not.toContain('In progress')
  })

  it('groups cases by verdict and renders dossier links with verdict chips', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchLibrary, {
        mode: 'personal-local',
        selectedStrategyLabel: 'Selected strategy: buffett-munger',
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
        selectedStrategyLabel: 'Selected strategy: buffett-munger',
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
        selectedStrategyLabel: 'Selected strategy: buffett-munger',
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
        selectedStrategyLabel: 'Selected strategy: buffett-munger',
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
})
