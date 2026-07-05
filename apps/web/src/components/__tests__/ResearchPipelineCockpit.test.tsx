import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ResearchPipelineCockpit,
  type ResearchPipelineSection,
} from '../ResearchPipelineCockpit'

function section(title: string, items: ResearchPipelineSection['items'] = []): ResearchPipelineSection {
  return {
    key: title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
    title,
    empty_message: `${title} empty`,
    items,
  }
}

describe('ResearchPipelineCockpit', () => {
  it('renders the selected strategy and every strategy pipeline section with next actions', () => {
    const html = renderToStaticMarkup(createElement(ResearchPipelineCockpit, {
      mode: 'personal-local',
      selectedStrategyLabel: 'Selected strategy: quality-growth@2026.06',
      sections: [
        section('Discovered', [{ id: 'candidate_msft', label: 'MSFT', status: 'discovered', next_action: 'Queue for quick screen' }]),
        section('Quick Screen', [{ id: 'rc_msft_quick', label: 'MSFT', status: 'deep_dive_candidate', href: '/research/rc_msft_quick', next_action: 'Send to deep dive queue' }]),
        section('Deep Dive Queue', [{ id: 'rc_adbe_queue', label: 'ADBE', status: 'queued_for_deep_dive', href: '/research/rc_adbe_queue', next_action: 'Start deep dive' }]),
        section('In Deep Dive', [{ id: 'rc_asml_deep', label: 'ASML', status: 'specialist_finding_recorded', href: '/research/rc_asml_deep', next_action: 'Draft synthesis' }]),
        section('Synthesis / Decision Pending', [{ id: 'rc_cost_decision', label: 'COST', status: 'decision_pending', href: '/research/rc_cost_decision', next_action: 'Review draft decision', summary: 'Durable membership economics remain attractive, but valuation still requires patience.' }]),
        section('Watchlist', [{ id: 'watch_cost', label: 'COST', status: 'watchlist_draft', href: '/watchlist', next_action: 'Legacy unconfirmed draft — re-admit from research' }]),
        section('Rejected / Passed', [{ id: 'rc_old_pass', label: 'OLD', status: 'pass', href: '/research/rc_old_pass', next_action: 'No action required' }]),
      ],
    }))

    expect(html).toContain('Strategy pipeline cockpit')
    expect(html).toContain('Selected strategy: quality-growth@2026.06')
    expect(html).toContain('Mode: personal-local')
    expect(html).toContain('Manual ticker intake')
    expect(html).toContain('href="/research/new"')
    expect(html).toContain('How this pipeline works')
    expect(html).toContain('href="/learn"')
    for (const title of ['Discovered', 'Quick Screen', 'Deep Dive Queue', 'In Deep Dive', 'Synthesis / Decision Pending', 'Watchlist', 'Rejected / Passed']) {
      expect(html).toContain(title)
    }
    for (const action of ['Queue for quick screen', 'Send to deep dive queue', 'Start deep dive', 'Draft synthesis', 'Review draft decision', 'Legacy unconfirmed draft — re-admit from research', 'No action required']) {
      expect(html).toContain(action)
    }
    expect(html).toContain('Investment brief')
    expect(html).toContain('Durable membership economics remain attractive, but valuation still requires patience.')
    expect(html).not.toContain('certified')
    expect(html).not.toContain('Certified')
  })

  it('keeps low-clutter empty sections visible without expanding explanations inline', () => {
    const html = renderToStaticMarkup(createElement(ResearchPipelineCockpit, {
      mode: 'personal-local',
      selectedStrategyLabel: 'Default strategy: buffett-munger',
      sections: [
        section('Discovered'),
        section('Quick Screen'),
        section('Deep Dive Queue'),
        section('In Deep Dive'),
        section('Synthesis / Decision Pending'),
        section('Watchlist'),
        section('Rejected / Passed'),
      ],
    }))

    expect(html).toContain('Discovered empty')
    expect(html).toContain('Quick Screen empty')
    expect(html).toContain('Default strategy: buffett-munger')
    expect(html).toContain('<details')
    expect(html).not.toContain('Buffett-Munger certified')
  })
})
