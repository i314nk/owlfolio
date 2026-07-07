import { createElement, Fragment } from 'react'

import {
  extractDiscoverySignal,
  type DiscoveryCandidateProjection,
} from '@owlfolio/ledger/projections/discoveryCandidateProjection'

import { DiscoveryCandidateActions } from './DiscoveryCandidateActions'
import { RunDiscoveryButton } from './RunDiscoveryButton'

export type DiscoveryPanelRunStatus = {
  last_run_status: string
  last_result_summary?: string
  last_started_at?: string
}

export type DiscoveryPanelProps = {
  candidates: DiscoveryCandidateProjection[]
  runStatus?: DiscoveryPanelRunStatus
}

/**
 * The Discovery triage panel — run trigger + status + candidate inbox grouped by workflow status.
 * Server component (createElement, no JSX). Client actions (accept/reject/promote) are delegated
 * to the DiscoveryCandidateActions client component.
 */
export function DiscoveryPanel({ candidates, runStatus }: DiscoveryPanelProps) {
  const discovered = candidates.filter((c) => c.status === 'discovered')
  const queued = candidates.filter((c) => c.status === 'queued_for_quick_screen')
  const resolved = candidates.filter((c) => c.status === 'rejected' || c.status === 'promoted_to_research_case')

  const runStatusLine = runStatus?.last_run_status === 'running'
    ? 'Running…'
    : runStatus?.last_result_summary ?? 'Never run'

  return createElement(
    Fragment,
    null,
    // Run bar
    createElement(
      'section',
      { 'aria-label': 'Discovery run controls', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent' }, 'Discovery harvest'),
      createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, runStatusLine),
      createElement(RunDiscoveryButton),
    ),
    // New candidates
    createElement(
      'section',
      { 'aria-label': 'New candidates', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent' }, `New candidates · ${discovered.length}`),
      discovered.length === 0
        ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No new candidates.')
        : createElement(
            'div',
            { className: 'owl-row-list' },
            ...discovered.map((c) => createCandidateCard(c)),
          ),
    ),
    // Screening
    createElement(
      'section',
      { 'aria-label': 'Screening queue', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent' }, `Screening · ${queued.length}`),
      queued.length === 0
        ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No candidates in screening.')
        : createElement(
            'div',
            { className: 'owl-row-list' },
            ...queued.map((c) => createCandidateCard(c)),
          ),
    ),
    // Resolved (collapsed)
    createElement(
      'section',
      { 'aria-label': 'Resolved candidates', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement(
        'details',
        null,
        createElement(
          'summary',
          { style: { color: 'var(--owl-color-quiet)', cursor: 'pointer', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } },
          `Resolved · ${resolved.length}`,
        ),
        resolved.length === 0
          ? createElement('p', { className: 'owl-row-helper', style: { margin: '0.5rem 0 0' } }, 'No resolved candidates.')
          : createElement(
              'div',
              { className: 'owl-row-list', style: { marginTop: 'var(--owl-space-2)' } },
              ...resolved.map((c) => createResolvedCard(c)),
            ),
      ),
    ),
  )
}

function createCandidateCard(candidate: DiscoveryCandidateProjection) {
  const signal = extractDiscoverySignal(candidate.discovery_metadata)

  return createElement(
    'div',
    { key: candidate.candidate_id, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('h3', { className: 'owl-row-title' }, `${candidate.ticker} — ${candidate.company_name}`),
      signal !== undefined
        ? createElement(
            'p',
            { className: 'owl-row-helper' },
            `${signal.signal_type} · ${signal.contributing_managers.join(', ')}`,
          )
        : null,
      createElement(DiscoveryCandidateActions, { candidateId: candidate.candidate_id, status: candidate.status }),
    ),
  )
}

function createResolvedCard(candidate: DiscoveryCandidateProjection) {
  const isPromoted = candidate.status === 'promoted_to_research_case'

  return createElement(
    'div',
    { key: candidate.candidate_id, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('h3', { className: 'owl-row-title' }, `${candidate.ticker} — ${candidate.company_name}`),
      isPromoted && candidate.research_case_id !== undefined
        ? createElement(
            'p',
            { className: 'owl-row-helper' },
            'Promoted — ',
            createElement('a', { href: `/research/${candidate.research_case_id}`, style: { color: 'var(--owl-color-gold-bright)' } }, 'View research case'),
          )
        : createElement('p', { className: 'owl-row-helper' }, isPromoted ? 'Promoted to research case' : 'Rejected'),
    ),
  )
}
