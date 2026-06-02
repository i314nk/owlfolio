import { createElement, type CSSProperties } from 'react'

import type { ProviderStatusRow } from '../lib/providerStatus'

export type ProviderStatusPanelProps = {
  rows: ProviderStatusRow[]
}

const pageStyle: CSSProperties = {
  color: '#f7f8ff',
  padding: '2rem 0 3rem',
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
  background: 'rgba(255, 255, 255, 0.035)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '1.25rem',
  boxShadow: '0 20px 45px rgba(0, 0, 0, 0.18)',
  display: 'grid',
  gap: '0.75rem',
  padding: '1.25rem',
}

const eyebrowStyle: CSSProperties = {
  color: '#7c8cff',
  fontSize: '0.85rem',
  fontWeight: 800,
  letterSpacing: '0.08em',
  margin: 0,
  textTransform: 'uppercase',
}

const subtleTextStyle: CSSProperties = {
  color: '#cbd5e1',
  margin: 0,
}

const glossaryEntries: Array<{ term: string; definition: string }> = [
  { term: 'Demo certified', definition: 'Demo certified means only the mock provider has passed deterministic demo/e2e workflow certification; it is not live research capability.' },
  { term: 'OAuth/session not signed in', definition: 'OAuth/session not signed in means a CLI or account-backed integration has no usable local session token for this machine.' },
  { term: 'Subscription unknown/detected', definition: 'Subscription unknown/detected separates account-session presence from paid API billing or workflow certification.' },
  { term: 'Quota/rate limited', definition: 'Quota/rate limited means credentials may exist but a provider run should remain blocked or retried until budget recovers.' },
  { term: 'Local availability', definition: 'Local availability means credentials or built-in demo mode are available to run on this machine; it is not workflow certification.' },
  { term: 'Certified', definition: 'Certified means the latest persisted certification report passed the full workflow.' },
  { term: 'Experimental', definition: 'Experimental means catalog support exists but full workflow certification is not proven.' },
  { term: 'Unsupported', definition: 'Unsupported means the latest report or catalog blocks provider-backed workflow starts.' },
  { term: 'Catalog support', definition: 'Catalog support is the static provider matrix claim.' },
  { term: 'Effective support', definition: 'Effective support is the latest certification-bounded support level used for gating.' },
  { term: 'Allowed use', definition: 'Allowed use states what Owlfolio permits after combining local availability with effective workflow support.' },
]

export function ProviderStatusPanel({ rows }: ProviderStatusPanelProps) {
  const summary = providerSummaryFrom(rows)

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
        createElement('h2', { style: { fontSize: '1.25rem', margin: 0 } }, 'Provider readiness summary'),
        createElement(
          'div',
          { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
          ...[
            ['Demo-only', summary.demoOnly],
            ['Blocked', summary.blocked],
            ['Experimental', summary.experimental],
            ['Certified live', summary.certifiedLive],
          ].map(([label, value]) => createElement(
            'p',
            { key: label, style: { background: 'rgba(15, 23, 42, 0.72)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: '0.9rem', color: '#f7f8ff', fontWeight: 900, margin: 0, padding: '0.8rem' } },
            `${label}: ${value}`,
          )),
        ),
        createElement('p', { style: subtleTextStyle }, 'Start actions are fail-closed: demo-only, experimental, blocked, and certified-live states remain distinct before any workflow can run.'),
      ),
      createElement(
        'section',
        { style: { ...cardStyle, marginBottom: '1rem' } },
        createElement('h2', { style: { fontSize: '1.25rem', margin: 0 } }, 'Readiness glossary'),
        createElement(
          'dl',
          { style: { color: '#cbd5e1', display: 'grid', gap: '0.5rem', margin: 0 } },
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
          { key: row.provider_id, style: providerCardStyle(row) },
          createElement('h2', { style: { fontSize: '1.4rem', margin: 0 } }, row.label),
          createElement('p', { style: subtleTextStyle }, row.description),
          createElement(
            'section',
            { style: providerGuardrailStyle(row) },
            createElement('strong', null, providerGuardrailHeadline(row)),
            createElement('span', null, providerGuardrailDescription(row)),
            row.readiness_state === 'unready' || row.effective_support_level === 'unsupported'
              ? createElement('span', null, 'Action: configure credentials, refresh readiness, or rerun certification after remediation.')
              : null,
          ),
          createElement(
            'section',
            { 'aria-label': `${row.label} provider readiness categories`, style: { display: 'grid', gap: '0.5rem' } },
            ...row.status_rows.map((status) => createElement(
              'div',
              {
                key: status.label,
                style: statusRowStyle(status),
              },
              createElement(
                'p',
                { style: { color: '#f7f8ff', fontWeight: 900, margin: 0 } },
                `${status.label}${status.label === 'Effective support' ? ' (gating source of truth)' : ''}: ${status.value}`,
              ),
              createElement('p', { style: { ...subtleTextStyle, fontSize: '0.9rem' } }, status.description),
            )),
          ),
          createElement('p', { style: { ...subtleTextStyle, fontWeight: 800 } }, `Model role: ${row.model_role}`),
          createElement(
            'section',
            null,
            createElement('h3', { style: { fontSize: '1rem', margin: '0 0 0.35rem' } }, 'Latest certification report'),
            row.last_certification_report === undefined
              ? createElement('p', { style: subtleTextStyle }, 'Workflow certification: No certification report recorded')
              : renderCertificationReport(row),
          ),
          createElement(
            'section',
            null,
            createElement('h3', { style: { fontSize: '1rem', margin: '0 0 0.35rem' } }, 'Limitations'),
            createElement(
              'ul',
              { style: { color: '#cbd5e1', margin: 0, paddingLeft: '1.2rem' } },
              ...row.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
            ),
          ),
        )),
      ),
    ),
  )
}

function providerSummaryFrom(rows: ProviderStatusRow[]): { blocked: number; certifiedLive: number; demoOnly: number; experimental: number } {
  return rows.reduce((summary, row) => {
    if (row.provider_id === 'mock-provider') {
      return { ...summary, demoOnly: summary.demoOnly + 1 }
    }

    if (!row.is_ready || row.effective_support_level === 'unsupported') {
      return { ...summary, blocked: summary.blocked + 1 }
    }

    if (row.effective_support_level === 'certified') {
      return { ...summary, certifiedLive: summary.certifiedLive + 1 }
    }

    return { ...summary, experimental: summary.experimental + 1 }
  }, { blocked: 0, certifiedLive: 0, demoOnly: 0, experimental: 0 })
}

function providerCardStyle(row: ProviderStatusRow): CSSProperties {
  if (!row.is_ready || row.effective_support_level === 'unsupported') {
    return { ...cardStyle, border: '1px solid rgba(248, 113, 113, 0.44)' }
  }

  if (row.effective_support_level === 'experimental') {
    return { ...cardStyle, border: '1px solid rgba(251, 191, 36, 0.34)' }
  }

  return cardStyle
}

function providerGuardrailStyle(row: ProviderStatusRow): CSSProperties {
  if (!row.is_ready || row.effective_support_level === 'unsupported') {
    return { background: 'rgba(248, 113, 113, 0.14)', border: '1px solid rgba(248, 113, 113, 0.36)', borderRadius: '0.95rem', color: '#fecaca', display: 'grid', gap: '0.35rem', padding: '0.85rem' }
  }

  if (row.effective_support_level === 'experimental') {
    return { background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: '0.95rem', color: '#fde68a', display: 'grid', gap: '0.35rem', padding: '0.85rem' }
  }

  return { background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.28)', borderRadius: '0.95rem', color: '#bbf7d0', display: 'grid', gap: '0.35rem', padding: '0.85rem' }
}

function providerGuardrailHeadline(row: ProviderStatusRow): string {
  if (!row.is_ready || row.effective_support_level === 'unsupported') {
    return `${row.label} is blocked: ${row.status_label}`
  }

  if (row.provider_id === 'mock-provider') {
    return `${row.label} is demo certified only.`
  }

  if (row.effective_support_level === 'experimental') {
    return `${row.label} is guarded: research drafts only until certification evidence passes.`
  }

  return `${row.label} has certified provider-backed workflow support.`
}

function providerGuardrailDescription(row: ProviderStatusRow): string {
  if (!row.is_ready || row.effective_support_level === 'unsupported') {
    return `Allowed use remains blocked because effective support is ${row.effective_support_level} and local availability is ${row.is_ready ? 'present' : 'missing'}.`
  }

  if (row.provider_id === 'mock-provider') {
    return 'Built-in demo mode can seed deterministic workflows, but it must not be described as live research intelligence.'
  }

  if (row.effective_support_level === 'experimental') {
    return 'OAuth/session or API credentials may be detected, but subscription, quota, and full workflow certification remain separate gates.'
  }

  return 'Latest certification evidence allows provider-backed workflow starts within Owlfolio approval gates.'
}

function statusRowStyle(status: ProviderStatusRow['status_rows'][number]): CSSProperties {
  const toneStyle: Record<string, Pick<CSSProperties, 'background' | 'border'>> = {
    danger: { background: 'rgba(248, 113, 113, 0.12)', border: '1px solid rgba(248, 113, 113, 0.34)' },
    neutral: { background: 'rgba(148, 163, 184, 0.08)', border: '1px solid rgba(148, 163, 184, 0.16)' },
    success: { background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.28)' },
    warning: { background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.26)' },
  }
  const base = status.label === 'Effective support'
    ? { background: 'rgba(124, 140, 255, 0.1)', border: '1px solid rgba(124, 140, 255, 0.28)' }
    : toneStyle[status.tone]

  return {
    ...base,
    borderRadius: '0.85rem',
    display: 'grid',
    gap: '0.35rem',
    padding: '0.75rem',
  }
}

function renderCertificationReport(row: ProviderStatusRow) {
  const report = row.last_certification_report
  if (report === undefined) {
    return null
  }

  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.25rem', overflowWrap: 'anywhere' } },
    createElement('p', { style: subtleTextStyle }, `Report ID: ${report.certification_report_id}`),
    createElement('p', { style: subtleTextStyle }, `Run status: ${report.run_status}`),
    createElement('p', { style: subtleTextStyle }, `Generated: ${report.generated_at}`),
    report.not_run_reason === undefined
      ? createElement('p', { style: subtleTextStyle }, report.summary)
      : createElement('p', { style: subtleTextStyle }, `Failure cause: ${report.not_run_reason}`),
    report.not_run_reason === undefined
      ? null
      : createElement('p', { style: subtleTextStyle }, `Technical detail: latest report marked provider support ${report.support_level}.`),
  )
}
