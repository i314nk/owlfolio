import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResearchCasePanel } from '../ResearchCasePanel'
import type { AppResearchCase } from '../../lib/workflow'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'

// Engine-version marker (the POOL episode): the dossier surfaces the run's reasoning vintage so a reader can
// tell at a glance whether the reasoning is current or from an older engine. Three states are exercised:
// present+current (calm), present+older (calm marker + amber caution), and absent (pre-versioning, unknown).

function baseCase(judgment: Record<string, unknown> | undefined): AppResearchCase {
  return {
    research_case_id: 'rc_engine_marker_001',
    version: 1,
    superseded: false,
    stage: 'decision_drafted',
    company_id: 'company_marker',
    ticker: 'EVM',
    strategy_id: 'buffett-munger',
    decision: 'WATCH',
    investment_verdict: 'WATCH',
    strategy_compliance: 'CONDITIONAL',
    shariah_status: 'COMPLIANT',
    valuation_status: 'FAIR',
    next_required_action: 'Audit the reasoning.',
    updated_at: '2026-06-09T12:00:00.000Z',
    valuation: {
      moat_class: 'wide',
      ...(judgment === undefined ? {} : { judgment }),
    },
    gate_checklist: [],
    source_ids: [],
    source_evidence: [],
    ledger_timeline: [],
  } as unknown as AppResearchCase
}

function render(researchCase: AppResearchCase): string {
  return renderToStaticMarkup(
    createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }),
  )
}

describe('ResearchCasePanel — engine-version marker', () => {
  it('present + current: renders a calm "Engine ... · generated" marker, no older-methodology caution', () => {
    const html = render(baseCase({ engine_version: ENGINE_VERSION }))
    expect(html).toContain('data-testid="engine-version-marker"')
    expect(html).toContain(ENGINE_VERSION)
    expect(html).toContain('generated')
    expect(html).not.toContain('may use older methodology')
  })

  it('present + older: renders the marker PLUS the amber "may use older methodology" caution', () => {
    const html = render(baseCase({ engine_version: 'engine-old/old' }))
    expect(html).toContain('data-testid="engine-version-marker"')
    expect(html).toContain('engine-old/old')
    expect(html).toContain('data-testid="engine-version-older"')
    expect(html).toContain('may use older methodology')
  })

  it('absent: renders "Engine version unknown · pre-versioning" and does NOT imply current', () => {
    const html = render(baseCase(undefined))
    expect(html).toContain('data-testid="engine-version-marker"')
    expect(html).toContain('Engine version unknown')
    expect(html).toContain('pre-versioning')
    expect(html).not.toContain('may use older methodology')
    expect(html).not.toContain(ENGINE_VERSION)
  })

  it('appends "· commit {short}" when engine_commit is stamped', () => {
    const html = render(baseCase({ engine_version: ENGINE_VERSION, engine_commit: 'abcdef1234567' }))
    expect(html).toContain('commit abcdef1')
    expect(html).not.toContain('abcdef1234567')
  })
})

// Root-level read: the early-exit reject/set-aside paths carry the engine version at the case ROOT and have
// NO valuation.judgment block. The marker must read the root field first (so a fresh set-aside reads current).
function rootCase(root: { engine_version?: string; engine_commit?: string }): AppResearchCase {
  return {
    research_case_id: 'rc_engine_marker_root',
    version: 1,
    superseded: false,
    stage: 'decision_drafted',
    company_id: 'company_marker',
    ticker: 'EVM',
    strategy_id: 'buffett-munger',
    decision: 'PASS',
    investment_verdict: 'PASS',
    strategy_compliance: 'INSUFFICIENT_DATA',
    valuation_status: 'INSUFFICIENT_DATA',
    next_required_action: 'Set aside — outside the circle of competence.',
    updated_at: '2026-06-09T12:00:00.000Z',
    // Set-aside path: a circle block but NO valuation.judgment.
    valuation: { circle_competence_unmet: true, outside_circle: true },
    ...root,
    gate_checklist: [],
    source_ids: [],
    source_evidence: [],
    ledger_timeline: [],
  } as unknown as AppResearchCase
}

describe('ResearchCasePanel — engine-version marker reads the ROOT field (set-aside path)', () => {
  it('present at root (no valuation.judgment): renders a calm current marker', () => {
    const html = render(rootCase({ engine_version: ENGINE_VERSION }))
    expect(html).toContain('data-testid="engine-version-marker"')
    expect(html).toContain(ENGINE_VERSION)
    expect(html).not.toContain('may use older methodology')
  })

  it('older at root: renders the marker PLUS the amber caution', () => {
    const html = render(rootCase({ engine_version: 'engine-old/old' }))
    expect(html).toContain('engine-old/old')
    expect(html).toContain('data-testid="engine-version-older"')
    expect(html).toContain('may use older methodology')
  })

  it('absent at root (genuinely old run): renders "unknown · pre-versioning"', () => {
    const html = render(rootCase({}))
    expect(html).toContain('Engine version unknown')
    expect(html).toContain('pre-versioning')
    expect(html).not.toContain(ENGINE_VERSION)
  })
})
