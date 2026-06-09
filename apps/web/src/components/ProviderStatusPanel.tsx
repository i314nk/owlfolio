import { createElement, type CSSProperties } from 'react'

import type { ProviderStatusRow } from '../lib/providerStatus'
import { OwlKpiStat, OwlRingGauge, RouteHeader } from './designSystem'

export type ProviderStatusPanelProps = {
  rows: ProviderStatusRow[]
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
  { term: 'Setup-only', definition: 'Setup-only is onboarding and readiness-discovery access that does not imply provider-backed workflow execution.' },
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
    { className: 'owl-route-frame owl-route-frame-wide' },
    createElement(
      'p',
      { className: 'owl-route-back-row' },
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),
    createElement(RouteHeader, {
      kicker: 'Owlfolio',
      title: 'Provider status',
      description: 'Readiness, role suitability, certification evidence, and limitations are shown separately so a local credential does not imply certified investment-decision support. Evidence comes from the T2 provider certification report format and the T3 provider/model support matrix; the latest persisted report below is the source of truth for effective support.',
    }),
    createElement(
      'section',
      { style: { display: 'grid', gap: '1rem' } },
      createProviderKpiRow(summary, rows.length),
      createElement(
        'section',
        { style: { ...cardStyle, marginBottom: '1rem' } },
        createElement('h2', { style: { fontSize: '1.25rem', margin: 0 } }, 'Provider readiness summary'),
        createElement(
          'div',
          { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
          createElement(
            'section',
            { style: { background: 'var(--owl-color-panel-deep)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: '0.9rem', display: 'grid', gap: '0.5rem', padding: '0.8rem' } },
            createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Allowed-use buckets'),
            ...[
              ['Demo-only', summary.allowedBuckets.demoOnly],
              ['Blocked', summary.allowedBuckets.blocked],
              ['Research draft', summary.allowedBuckets.researchDraft],
              ['Setup-only', summary.allowedBuckets.setupOnly],
              ['Certified live', summary.allowedBuckets.certifiedLive],
            ].map(([label, value]) => createElement('p', { key: `allowed-${label}`, style: subtleTextStyle }, `${label}: ${value}`)),
          ),
          createElement(
            'section',
            { style: { background: 'var(--owl-color-panel-deep)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: '0.9rem', display: 'grid', gap: '0.5rem', padding: '0.8rem' } },
            createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Catalog support buckets'),
            ...[
              ['Certified', summary.catalogBuckets.certified],
              ['Experimental', summary.catalogBuckets.experimental],
              ['Unsupported', summary.catalogBuckets.unsupported],
            ].map(([label, value]) => createElement('p', { key: `catalog-${label}`, style: subtleTextStyle }, `${label}: ${value}`)),
          ),
          createElement(
            'section',
            { style: { background: 'var(--owl-color-panel-deep)', border: '1px solid var(--owl-color-border)', borderRadius: '0.9rem', display: 'grid', gap: '0.5rem', padding: '0.8rem' } },
            createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Effective support buckets'),
            ...[
              ['Certified', summary.effectiveBuckets.certified],
              ['Experimental', summary.effectiveBuckets.experimental],
              ['Unsupported', summary.effectiveBuckets.unsupported],
            ].map(([label, value]) => createElement('p', { key: `effective-${label}`, style: subtleTextStyle }, `${label}: ${value}`)),
          ),
        ),
        createElement(
          'p',
          { style: subtleTextStyle },
          'Allowed-use outcomes (left) are the action language per-card. Keep them separate from static catalog claims and certification-bounded effective support (right) to avoid accidental over-trust.',
        ),
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
        ...rows.map((row) => {
          const [primaryStatusRows, secondaryStatusRows] = prioritizeStatusRows(row.status_rows)

          return createElement(
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
              { 'aria-label': `${row.label} provider primary status`, style: { display: 'grid', gap: '0.5rem' } },
              createElement('h3', { style: { fontSize: '1rem', margin: '0 0 0.35rem' } }, 'Primary status and action'),
              ...renderStatusRows(primaryStatusRows),
            ),
            createElement(
              'details',
              { style: { display: 'grid', gap: '0.5rem' } },
              createElement('summary', { style: { cursor: 'pointer', fontWeight: 800 } }, 'Evidence details (readiness rows, certification, limitations)'),
              createElement(
                'section',
                { 'aria-label': `${row.label} provider evidence readiness rows`, style: { display: 'grid', gap: '0.5rem', marginTop: '0.5rem' } },
                ...renderStatusRows(secondaryStatusRows),
              ),
              createElement(
                'section',
                null,
                createElement('h3', { style: { fontSize: '1rem', margin: '0.5rem 0 0.35rem' } }, 'Latest certification report'),
                row.last_certification_report === undefined
                  ? createElement('p', { style: subtleTextStyle }, 'Workflow certification: No certification report recorded')
                  : renderCertificationReport(row),
              ),
              createElement(
                'section',
                null,
                createElement('h3', { style: { fontSize: '1rem', margin: '0.5rem 0 0.35rem' } }, 'Limitations'),
                createElement(
                  'ul',
                  { style: { color: '#cbd5e1', margin: 0, paddingLeft: '1.2rem' } },
                  ...row.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
                ),
              ),
            ),
            createElement('p', { style: { ...subtleTextStyle, fontWeight: 800 } }, `Model role: ${row.model_role}`),
          )
        }),
      ),
    ),
  )
}

function createProviderKpiRow(summary: ProviderSummary, totalProviders: number) {
  const certified = summary.effectiveBuckets.certified
  const experimental = summary.effectiveBuckets.experimental
  const unsupported = summary.effectiveBuckets.unsupported
  const certifiedPct = totalProviders === 0 ? 0 : Math.round((certified / totalProviders) * 100)

  return createElement(
    'section',
    { 'aria-label': 'Provider effective-support summary', className: 'owl-kpi-row', style: { marginBottom: '1rem' } },
    createElement(
      'div',
      { className: 'owl-kpi-panel owl-kpi-panel-gold' },
      createElement(OwlKpiStat, {
        label: 'Certified (effective)',
        value: String(certified),
        tone: 'emerald',
      }),
      createElement(OwlRingGauge, {
        value: certifiedPct,
        label: 'Certified',
        tone: certified === 0 ? 'amber' : 'emerald',
        size: 64,
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Experimental',
        value: String(experimental),
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Unsupported',
        value: String(unsupported),
        tone: unsupported > 0 ? 'risk' : 'gold',
      }),
    ),
  )
}

type ProviderSummary = {
  allowedBuckets: {
    blocked: number
    demoOnly: number
    researchDraft: number
    setupOnly: number
    certifiedLive: number
  }
  catalogBuckets: {
    certified: number
    experimental: number
    unsupported: number
  }
  effectiveBuckets: {
    certified: number
    experimental: number
    unsupported: number
  }
}

function providerSummaryFrom(rows: ProviderStatusRow[]): ProviderSummary {
  return rows.reduce(
    (summary, row) => {
      const allowedUse = row.status_rows.find((statusRow) => statusRow.label === 'Allowed use')?.value ?? 'Unknown'
      let updated: ProviderSummary = { ...summary }

      if (row.provider_id === 'mock-provider' || allowedUse.includes('Demo/e2e deterministic fixture only')) {
        updated = {
          ...updated,
          allowedBuckets: {
            ...updated.allowedBuckets,
            demoOnly: updated.allowedBuckets.demoOnly + 1,
          },
        }
      } else if (allowedUse.includes('Setup and readiness discovery only') || row.provider_id === 'gemini-cli') {
        updated = {
          ...updated,
          allowedBuckets: {
            ...updated.allowedBuckets,
            setupOnly: updated.allowedBuckets.setupOnly + 1,
          },
        }
      } else if (allowedUse.includes('Research drafts only') || (row.is_ready && row.effective_support_level === 'experimental')) {
        updated = {
          ...updated,
          allowedBuckets: {
            ...updated.allowedBuckets,
            researchDraft: updated.allowedBuckets.researchDraft + 1,
          },
        }
      } else if (allowedUse.includes('Blocked for provider-backed workflow starts') || !row.is_ready || row.effective_support_level === 'unsupported') {
        updated = {
          ...updated,
          allowedBuckets: {
            ...updated.allowedBuckets,
            blocked: updated.allowedBuckets.blocked + 1,
          },
        }
      } else {
        updated = {
          ...updated,
          allowedBuckets: {
            ...updated.allowedBuckets,
            certifiedLive: updated.allowedBuckets.certifiedLive + 1,
          },
        }
      }

      return {
        ...updated,
        catalogBuckets: {
          ...updated.catalogBuckets,
          [row.catalog_support_level]: updated.catalogBuckets[row.catalog_support_level] + 1,
        },
        effectiveBuckets: {
          ...updated.effectiveBuckets,
          [row.effective_support_level]: updated.effectiveBuckets[row.effective_support_level] + 1,
        },
      }
    },
    {
      allowedBuckets: {
        blocked: 0,
        demoOnly: 0,
        researchDraft: 0,
        setupOnly: 0,
        certifiedLive: 0,
      },
      catalogBuckets: {
        certified: 0,
        experimental: 0,
        unsupported: 0,
      },
      effectiveBuckets: {
        certified: 0,
        experimental: 0,
        unsupported: 0,
      },
    },
  )
}

function isSetupOnly(row: ProviderStatusRow): boolean {
  const allowedUse = row.status_rows.find((statusRow) => statusRow.label === 'Allowed use')?.value ?? ''
  return allowedUse.includes('Setup and readiness discovery only') || row.provider_id === 'gemini-cli'
}

function isBlocked(row: ProviderStatusRow): boolean {
  return !row.is_ready || row.effective_support_level === 'unsupported'
}

function providerCardStyle(row: ProviderStatusRow): CSSProperties {
  if (isSetupOnly(row)) {
    return { ...cardStyle, border: '1px solid rgba(251, 191, 36, 0.34)' }
  }

  if (isBlocked(row)) {
    return { ...cardStyle, border: '1px solid rgba(248, 113, 113, 0.44)' }
  }

  if (row.effective_support_level === 'experimental') {
    return { ...cardStyle, border: '1px solid rgba(251, 191, 36, 0.34)' }
  }

  return cardStyle
}

function providerGuardrailStyle(row: ProviderStatusRow): CSSProperties {
  if (isSetupOnly(row)) {
    return { background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: '0.95rem', color: '#fde68a', display: 'grid', gap: '0.35rem', padding: '0.85rem' }
  }

  if (isBlocked(row)) {
    return { background: 'rgba(248, 113, 113, 0.14)', border: '1px solid rgba(248, 113, 113, 0.36)', borderRadius: '0.95rem', color: '#fecaca', display: 'grid', gap: '0.35rem', padding: '0.85rem' }
  }

  if (row.effective_support_level === 'experimental') {
    return { background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: '0.95rem', color: '#fde68a', display: 'grid', gap: '0.35rem', padding: '0.85rem' }
  }

  return { background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.28)', borderRadius: '0.95rem', color: '#bbf7d0', display: 'grid', gap: '0.35rem', padding: '0.85rem' }
}

function providerGuardrailHeadline(row: ProviderStatusRow): string {
  const allowedUse = row.status_rows.find((statusRow) => statusRow.label === 'Allowed use')?.value ?? ''

  if (isSetupOnly(row)) {
    return `${row.label} is setup-only: ${allowedUse}`
  }

  if (isBlocked(row) || allowedUse.includes('Blocked for provider-backed workflow starts')) {
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
  const allowedUse = row.status_rows.find((statusRow) => statusRow.label === 'Allowed use')?.value ?? ''

  if (isSetupOnly(row)) {
    return `Execution remains intentionally limited while the adapter and cert path are completed; readiness checks and onboarding can still proceed.`
  }

  if (isBlocked(row) || allowedUse.includes('Blocked for provider-backed workflow starts')) {
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

function prioritizeStatusRows(
  statusRows: ProviderStatusRow['status_rows'],
): [Array<ProviderStatusRow['status_rows'][number]>, Array<ProviderStatusRow['status_rows'][number]>] {
  const primaryLabels = ['Allowed use', 'Effective support', 'Catalog support']
  const primaryRows: Array<ProviderStatusRow['status_rows'][number]> = []
  const secondaryRows: Array<ProviderStatusRow['status_rows'][number]> = []

  for (const statusRow of statusRows) {
    if (primaryLabels.includes(statusRow.label)) {
      primaryRows.push(statusRow)
    } else {
      secondaryRows.push(statusRow)
    }
  }

  const orderedPrimaryRows = primaryLabels
    .map((label) => primaryRows.find((statusRow) => statusRow.label === label))
    .filter((statusRow): statusRow is ProviderStatusRow['status_rows'][number] => statusRow !== undefined)

  return [orderedPrimaryRows, secondaryRows]
}

function renderStatusRows(statusRows: Array<ProviderStatusRow['status_rows'][number]>) {
  return statusRows.map((status) =>
    createElement(
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
    ),
  )
}


function statusRowStyle(status: ProviderStatusRow['status_rows'][number]): CSSProperties {
  const toneStyle: Record<string, Pick<CSSProperties, 'background' | 'border'>> = {
    danger: { background: 'rgba(248, 113, 113, 0.12)', border: '1px solid rgba(248, 113, 113, 0.34)' },
    neutral: { background: 'rgba(148, 163, 184, 0.08)', border: '1px solid rgba(148, 163, 184, 0.16)' },
    success: { background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.28)' },
    warning: { background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.26)' },
  }
  const base = status.label === 'Effective support'
    ? { background: 'rgba(22, 163, 74, 0.08)', border: '1px solid var(--owl-color-border-strong)' }
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
    report.target === undefined
      ? null
      : createElement('p', { style: subtleTextStyle }, `Certified target: ${report.target.provider_surface_id} / ${report.target.auth_mode} / ${report.target.workflow_role} / ${report.target.model_id}`),
    createElement('p', { style: subtleTextStyle }, `Generated: ${report.generated_at}`),
    report.not_run_reason === undefined
      ? createElement('p', { style: subtleTextStyle }, report.summary)
      : createElement('p', { style: subtleTextStyle }, `Failure cause: ${report.not_run_reason}`),
    report.not_run_reason === undefined
      ? null
      : createElement('p', { style: subtleTextStyle }, `Technical detail: latest report marked provider support ${report.support_level}.`),
  )
}
