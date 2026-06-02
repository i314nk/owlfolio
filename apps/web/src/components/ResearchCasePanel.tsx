import { createElement } from 'react'

import { SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'
import type { AppResearchCase, WorkflowMode } from '../lib/workflow'

export type ResearchCasePanelProps = {
  researchCase: AppResearchCase
  mode?: WorkflowMode
}

const cardStyle = {
  background: 'rgba(255, 255, 255, 0.035)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '1rem',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.18)',
  padding: '1.25rem',
}

const labelStyle = {
  color: '#9aa4b7',
  fontSize: '0.78rem',
  fontWeight: 800,
  margin: 0,
  textTransform: 'uppercase' as const,
}

const valueStyle = {
  color: '#f7f8ff',
  fontSize: '1.05rem',
  fontWeight: 800,
  margin: '0.35rem 0 0',
}

export function ResearchCasePanel({ researchCase, mode = 'demo' }: ResearchCasePanelProps) {
  const canPromoteToWatchlist = mode === 'personal-local'
    && researchCase.stage === 'decision_drafted'
    && researchCase.decision !== undefined
    && researchCase.decision_id !== undefined

  return createElement(
    'section',
    {
      style: {
        display: 'grid',
        gap: '1rem',
      },
    },
    createElement(
      'header',
      {
        style: {
          background: 'linear-gradient(135deg, rgba(124, 140, 255, 0.12) 0%, rgba(10, 132, 255, 0.08) 100%)',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          borderRadius: '1.25rem',
          padding: '1.5rem',
        },
      },
      createElement('p', { style: labelStyle }, 'Research case'),
      createElement(
        'h1',
        { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: '0.5rem 0' } },
        researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id,
      ),
      createElement(
        'p',
        { style: { color: '#9aa4b7', fontSize: '1rem', margin: 0 } },
        `Company: ${researchCase.company_id ?? 'Unknown company'}`,
      ),
    ),
    canPromoteToWatchlist ? createWatchlistPromotionAction(researchCase.research_case_id) : null,
    createCurrentWorkflowStatus(researchCase),
    createElement(
      'div',
      {
        style: {
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        },
      },
      createMetric('Investment verdict', researchCase.investment_verdict ?? 'Pending'),
      createMetric('Strategy compliance', researchCase.strategy_compliance ?? 'Pending'),
      createMetric('Shariah status', researchCase.shariah_status ?? 'Pending'),
      createMetric('Valuation status', researchCase.valuation_status ?? 'Pending'),
      createMetric('Strategy', researchCase.strategy_id ?? 'Unknown'),
    ),
    createResearchTransitionPanel(researchCase),
    createElement(
      'section',
      { style: cardStyle },
      createElement('h2', { style: { fontSize: '1.25rem', margin: '0 0 1rem' } }, 'Gate checklist'),
      createElement(
        'ul',
        { style: { display: 'grid', gap: '0.75rem', listStyle: 'none', margin: 0, padding: 0 } },
        ...researchCase.gate_checklist.map((gate) =>
          createElement(
            'li',
            {
              key: gate.label,
              style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' },
            },
            createElement(StatusBadge, { tone: gate.tone }, gate.status),
            createElement(
              'span',
              { style: { display: 'grid', gap: '0.25rem' } },
              createElement('span', { style: { fontWeight: 700 } }, gate.label),
              createElement('span', { style: { color: '#9aa4b7', fontSize: '0.86rem' } }, `Evidence source context: ${describeGateEvidence(gate.label, researchCase.source_ids)}`),
            ),
          ),
        ),
      ),
    ),
    createElement(
      'section',
      { style: cardStyle },
      createElement('h2', { style: { fontSize: '1.25rem', margin: '0 0 0.75rem' } }, 'Source IDs'),
      createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
        ...researchCase.source_ids.map((sourceId) => createElement(SourceChip, { id: sourceId, key: sourceId, label: 'Audit source' })),
      ),
    ),
    createElement(
      'section',
      { style: cardStyle },
      createElement('h2', { style: { fontSize: '1.25rem', margin: '0 0 0.35rem' } }, 'Ledger Timeline'),
      createElement(
        'p',
        { style: { color: '#9aa4b7', fontSize: '0.95rem', margin: '0 0 1rem' } },
        'How did this state come to exist?',
      ),
      createElement(
        'ol',
        { style: { color: '#cbd5e1', display: 'grid', gap: '0.85rem', margin: 0, paddingLeft: '1.25rem' } },
        ...researchCase.ledger_timeline.map((entry) =>
          createElement(
            'li',
            { key: entry.event_id },
            createElement('p', { style: { fontWeight: 900, margin: 0 } }, entry.event_type),
            createElement('p', { style: { margin: '0.2rem 0 0' } }, entry.summary),
            createElement(
              'p',
              { style: { color: '#9aa4b7', fontSize: '0.85rem', margin: '0.2rem 0 0' } },
              `${entry.actor_label} • ${entry.created_at}`,
            ),
          ),
        ),
      ),
    ),
    createElement(
      'section',
      { style: cardStyle },
      createElement('p', { style: labelStyle }, 'Next required action'),
      createElement(
        'p',
        { style: { color: '#f7f8ff', fontSize: '1.2rem', fontWeight: 800, margin: '0.4rem 0 0' } },
        researchCase.next_required_action ?? 'Continue the review workflow',
      ),
    ),
  )
}

function createCurrentWorkflowStatus(researchCase: AppResearchCase) {
  const statusLabel = describeWorkflowStatus(researchCase)

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Current workflow status'),
    createElement('p', { style: { color: '#f7f8ff', fontSize: '1.25rem', fontWeight: 900, margin: '0.35rem 0 0' } }, statusLabel),
    createElement('p', { style: { color: '#9aa4b7', fontSize: '0.9rem', margin: '0.55rem 0 0' } }, `Raw stage token: ${researchCase.stage}`),
  )
}

function describeWorkflowStatus(researchCase: AppResearchCase): string {
  const stageLabel = humanizeToken(researchCase.stage)
  const actionHint = researchCase.next_required_action === undefined
    ? 'Workflow review required'
    : 'User action required'

  return `${stageLabel} · ${actionHint}`
}

function describeGateEvidence(label: string, sourceIds: string[]) {
  if (sourceIds.length === 0) {
    return `${label} is awaiting source-backed evidence.`
  }

  return `${label} is tied to ${sourceIds.join(', ')}.`
}

function humanizeToken(value: string): string {
  const words = value
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase())

  const firstWord = words.at(0)

  if (firstWord === undefined) {
    return value
  }

  return [`${firstWord.charAt(0).toUpperCase()}${firstWord.slice(1)}`, ...words.slice(1)].join(' ')
}

function createWatchlistPromotionAction(researchCaseId: string) {
  return createElement(
    'section',
    {
      style: {
        ...cardStyle,
        border: '1px solid #c7d2fe',
        background: 'rgba(124, 140, 255, 0.12)',
      },
    },
    createElement('p', { style: labelStyle }, 'User confirmation'),
    createElement(
      'p',
      { style: { color: '#c7d2fe', fontSize: '1rem', fontWeight: 700, margin: '0.35rem 0 1rem' } },
      'Advance this drafted decision into durable personal-local watchlist state.',
    ),
    createElement(
      'form',
      { action: `/api/research/${researchCaseId}/watchlist`, method: 'post' },
      createElement(
        'button',
        {
          type: 'submit',
          style: {
            background: '#6366f1',
            border: 0,
            borderRadius: '999px',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: 900,
            padding: '0.75rem 1rem',
          },
        },
        'Promote to watchlist',
      ),
    ),
  )
}

function createResearchTransitionPanel(researchCase: AppResearchCase) {
  const latestProviderEntry = [...researchCase.ledger_timeline].reverse().find((entry) => entry.actor_label.startsWith('provider:'))
  const latestUserEntry = [...researchCase.ledger_timeline].reverse().find((entry) => entry.actor_label.startsWith('user:'))

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Research transition map'),
    createElement(
      'div',
      { className: 'owl-workflow-grid' },
      createElement(
        'section',
        { className: 'owl-workflow-panel owl-workflow-panel-draft' },
        createElement('h2', { style: { fontSize: '1.05rem', margin: 0 } }, 'Provider draft state'),
        createElement('p', { style: { color: '#9aa4b7', margin: '0.45rem 0 0' } }, latestProviderEntry?.summary ?? 'Provider draft has not been recorded yet.'),
        createDetail('Decision', researchCase.decision ?? researchCase.investment_verdict ?? 'Pending'),
        createDetail('Strategy gate', researchCase.strategy_compliance ?? 'Pending'),
      ),
      createElement(
        'section',
        { className: 'owl-workflow-panel owl-workflow-panel-gate' },
        createElement('h2', { style: { fontSize: '1.05rem', margin: 0 } }, 'Source-backed Shariah gate'),
        createElement('p', { style: { color: '#9aa4b7', margin: '0.45rem 0 0' } }, `Shariah status: ${researchCase.shariah_status ?? 'Pending'}`),
        createDetail('Source evidence', researchCase.source_ids.length === 0 ? 'No source IDs recorded' : researchCase.source_ids.join(', ')),
        createDetail('Valuation gate', researchCase.valuation_status ?? 'Pending'),
      ),
      createElement(
        'section',
        { className: 'owl-workflow-panel owl-workflow-panel-user' },
        createElement('h2', { style: { fontSize: '1.05rem', margin: 0 } }, 'User transition checkpoint'),
        createElement('p', { style: { color: '#9aa4b7', margin: '0.45rem 0 0' } }, latestUserEntry?.summary ?? 'Awaiting user-authored transition.'),
        createDetail('Next action', researchCase.next_required_action ?? 'Continue the review workflow'),
      ),
    ),
  )
}

function createMetric(label: string, value: string) {
  return createElement(
    'article',
    { style: cardStyle },
    createElement('p', { style: labelStyle }, label),
    createElement('p', { style: valueStyle }, value),
  )
}

function createDetail(label: string, value: string) {
  return createElement(
    'p',
    { style: { color: '#cbd5e1', margin: '0.55rem 0 0' } },
    createElement('strong', null, `${label}: `),
    value,
  )
}
