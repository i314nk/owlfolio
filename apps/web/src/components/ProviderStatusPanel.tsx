import { createElement, type CSSProperties } from 'react'

import { StatusBadge, type StatusBadgeTone } from './StatusBadge'
import type { ProviderStatusRow } from '../lib/providerStatus'

export type ProviderStatusPanelProps = {
  rows: ProviderStatusRow[]
}

const pageStyle: CSSProperties = {
  background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)',
  color: '#0f172a',
  minHeight: '100vh',
  padding: '3rem clamp(1rem, 4vw, 4rem)',
}

const shellStyle: CSSProperties = {
  margin: '0 auto',
  maxWidth: '1120px',
}

const cardGridStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
}

const cardStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #dbeafe',
  borderRadius: '1.25rem',
  boxShadow: '0 20px 45px rgba(15, 23, 42, 0.08)',
  display: 'grid',
  gap: '0.75rem',
  padding: '1.25rem',
}

const eyebrowStyle: CSSProperties = {
  color: '#047857',
  fontSize: '0.85rem',
  fontWeight: 800,
  letterSpacing: '0.08em',
  margin: 0,
  textTransform: 'uppercase',
}

const subtleTextStyle: CSSProperties = {
  color: '#475569',
  margin: 0,
}

const glossaryEntries: Array<{ term: string; definition: string }> = [
  { term: 'Ready', definition: 'Ready means local credentials or built-in demo mode are available.' },
  { term: 'Certified', definition: 'Certified means the latest persisted certification report passed the full workflow.' },
  { term: 'Experimental', definition: 'Experimental means catalog support exists but full workflow certification is not proven.' },
  { term: 'Unsupported', definition: 'Unsupported means the latest report or catalog blocks provider-backed workflow starts.' },
  { term: 'Catalog support', definition: 'Catalog support is the static provider matrix claim.' },
  { term: 'Effective support', definition: 'Effective support is the latest certification-bounded support level used for gating.' },
]

export function ProviderStatusPanel({ rows }: ProviderStatusPanelProps) {
  return createElement(
    'main',
    { style: pageStyle },
    createElement(
      'section',
      { style: shellStyle },
      createElement('p', { style: eyebrowStyle }, 'Owlfolio'),
      createElement('h1', { style: { fontSize: 'clamp(2.25rem, 5vw, 4rem)', lineHeight: 1, margin: '0.5rem 0 1rem' } }, 'Provider status'),
      createElement(
        'p',
        { style: { ...subtleTextStyle, fontSize: '1.05rem', marginBottom: '2rem', maxWidth: '820px' } },
        'Readiness, role suitability, certification evidence, and limitations are shown separately so a local credential does not imply certified investment-decision support. Evidence comes from the T2 provider certification report format and the T3 provider/model support matrix; the latest persisted report below is the source of truth for effective support.',
      ),
      createElement(
        'section',
        { style: { ...cardStyle, marginBottom: '1rem' } },
        createElement('h2', { style: { fontSize: '1.25rem', margin: 0 } }, 'Readiness glossary'),
        createElement(
          'dl',
          { style: { color: '#334155', display: 'grid', gap: '0.5rem', margin: 0 } },
          ...glossaryEntries.flatMap((entry) => [
            createElement('dt', { key: `${entry.term}-term`, style: { fontWeight: 900 } }, entry.term),
            createElement('dd', { key: `${entry.term}-definition`, style: { margin: 0 } }, entry.definition),
          ]),
        ),
      ),
      createElement(
        'div',
        { style: cardGridStyle },
        ...rows.map((row) => createElement(
          'article',
          { key: row.provider_id, style: cardStyle },
          createElement(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
            createElement(StatusBadge, { tone: badgeTone(row.readiness_state) }, row.readiness_state),
            createElement(StatusBadge, { tone: row.effective_support_level === 'certified' ? 'success' : 'neutral' }, row.effective_support_level),
            createElement(StatusBadge, { tone: row.is_ready ? 'success' : 'warning' }, row.is_ready ? 'ready' : 'not ready'),
          ),
          createElement('h2', { style: { fontSize: '1.4rem', margin: 0 } }, row.label),
          createElement('p', { style: subtleTextStyle }, row.description),
          createElement('p', { style: subtleTextStyle }, `Readiness: ${row.status_label}`),
          createElement('p', { style: subtleTextStyle }, `Auth source: ${row.auth_source}`),
          createElement('p', { style: subtleTextStyle }, `Effective support: ${row.effective_support_level}`),
          createElement('p', { style: subtleTextStyle }, `Catalog support: ${row.catalog_support_level}`),
          createElement('p', { style: { ...subtleTextStyle, fontWeight: 800 } }, `Model role: ${row.model_role}`),
          createElement(
            'section',
            null,
            createElement('h3', { style: { fontSize: '1rem', margin: '0 0 0.35rem' } }, 'Latest certification report'),
            row.last_certification_report === undefined
              ? createElement('p', { style: subtleTextStyle }, 'No certification report recorded')
              : createElement(
                  'div',
                  { style: { display: 'grid', gap: '0.25rem' } },
                  createElement('p', { style: subtleTextStyle }, row.last_certification_report.certification_report_id),
                  createElement('p', { style: subtleTextStyle }, `Run status: ${row.last_certification_report.run_status}`),
                  row.last_certification_report.not_run_reason === undefined || row.last_certification_report.not_run_reason === row.status_label
                    ? null
                    : createElement('p', { style: subtleTextStyle }, `Not-run reason: ${row.last_certification_report.not_run_reason}`),
                  createElement('p', { style: subtleTextStyle }, `Generated: ${row.last_certification_report.generated_at}`),
                  createElement('p', { style: subtleTextStyle }, row.last_certification_report.summary),
                ),
          ),
          createElement(
            'section',
            null,
            createElement('h3', { style: { fontSize: '1rem', margin: '0 0 0.35rem' } }, 'Limitations'),
            createElement(
              'ul',
              { style: { color: '#475569', margin: 0, paddingLeft: '1.2rem' } },
              ...row.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
            ),
          ),
        )),
      ),
    ),
  )
}

function badgeTone(readinessState: ProviderStatusRow['readiness_state']): StatusBadgeTone {
  if (readinessState === 'supported') {
    return 'success'
  }

  if (readinessState === 'unready') {
    return 'warning'
  }

  return 'neutral'
}
