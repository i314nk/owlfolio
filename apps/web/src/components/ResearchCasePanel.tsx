import { createElement } from 'react'

import { StatusBadge } from './StatusBadge'
import type { DemoResearchCase } from '../lib/demo'

export type ResearchCasePanelProps = {
  researchCase: DemoResearchCase
}

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '1rem',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
  padding: '1.25rem',
}

const labelStyle = {
  color: '#64748b',
  fontSize: '0.78rem',
  fontWeight: 800,
  margin: 0,
  textTransform: 'uppercase' as const,
}

const valueStyle = {
  color: '#0f172a',
  fontSize: '1.05rem',
  fontWeight: 800,
  margin: '0.35rem 0 0',
}

export function ResearchCasePanel({ researchCase }: ResearchCasePanelProps) {
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
          background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)',
          border: '1px solid #dbeafe',
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
        { style: { color: '#475569', fontSize: '1rem', margin: 0 } },
        `Company: ${researchCase.company_id ?? 'Unknown company'}`,
      ),
    ),
    createElement(
      'div',
      {
        style: {
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        },
      },
      createMetric('Workflow stage', researchCase.stage),
      createMetric('Investment verdict', researchCase.investment_verdict ?? 'Pending'),
      createMetric('Strategy compliance', researchCase.strategy_compliance ?? 'Pending'),
      createMetric('Shariah status', researchCase.shariah_status ?? 'Pending'),
      createMetric('Valuation status', researchCase.valuation_status ?? 'Pending'),
      createMetric('Strategy', researchCase.strategy_id ?? 'Unknown'),
    ),
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
            createElement('span', { style: { fontWeight: 700 } }, gate.label),
          ),
        ),
      ),
    ),
    createElement(
      'section',
      { style: cardStyle },
      createElement('h2', { style: { fontSize: '1.25rem', margin: '0 0 0.75rem' } }, 'Source IDs'),
      createElement(
        'ul',
        { style: { color: '#334155', margin: 0, paddingLeft: '1.25rem' } },
        ...researchCase.source_ids.map((sourceId) => createElement('li', { key: sourceId }, sourceId)),
      ),
    ),
    createElement(
      'section',
      { style: cardStyle },
      createElement('p', { style: labelStyle }, 'Next required action'),
      createElement(
        'p',
        { style: { color: '#0f172a', fontSize: '1.2rem', fontWeight: 800, margin: '0.4rem 0 0' } },
        researchCase.next_required_action ?? 'Continue the review workflow',
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
