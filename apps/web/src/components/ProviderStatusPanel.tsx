import { createElement, type CSSProperties, type ReactNode } from 'react'

import type { ProviderInvestmentGrade, ProviderStatusRow } from '../lib/providerStatus'
import { RouteHeader } from './designSystem'

export type ProviderStatusPanelProps = {
  rows: ProviderStatusRow[]
}

const subtleTextStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-sm)',
  lineHeight: 1.5,
  margin: 0,
}

const monoLabelStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  fontWeight: 600,
  letterSpacing: '0.12em',
  margin: 0,
  textTransform: 'uppercase',
}

const monoValueStyle: CSSProperties = {
  color: 'var(--owl-color-text)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  fontVariantNumeric: 'tabular-nums',
}

const summaryStyle: CSSProperties = {
  color: 'var(--owl-color-gold-bright)',
  cursor: 'pointer',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 700,
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

/**
 * Provider status — the Fiduciary Briefing trust gate.
 *
 * This page answers one question for the principal: which AI models are
 * TRUSTED for investment-grade research, and which are not yet. It leads with
 * certification posture (the vital-signs ledger line), groups candidates by
 * investment grade, and puts each provider's honest effective-support and
 * "suitable for research" verdict front-and-center — with the certification
 * evidence available on demand. Fail-closed honesty throughout.
 */
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
      kicker: 'Owlfolio · Trust gate',
      title: 'Provider status',
      description: 'The trust gate for your agent’s brain: which AI models are certified for investment-grade research, and which are not yet. Readiness, role suitability, certification evidence, and limitations are shown separately so a local credential does not imply certified investment-decision support. The latest persisted certification report is the source of truth for effective support.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    createCertificationLedgerLine(summary),
    createGlossary(),
    ...renderProviderGroups(rows),
  )
}

// ── Certification posture (the vital-signs ledger line) ───────────────────────

function createCertificationLedgerLine(summary: ProviderSummary) {
  const certified = summary.effectiveBuckets.certified
  const experimental = summary.effectiveBuckets.experimental
  const unsupported = summary.effectiveBuckets.unsupported

  const stats: Array<{ figureClass: string; label: string; value: number }> = [
    { figureClass: 'owl-ledger-figure-emerald', label: 'Certified', value: certified },
    { figureClass: '', label: 'Candidates', value: experimental },
    { figureClass: unsupported > 0 ? 'owl-ledger-figure-risk' : '', label: 'Unsupported', value: unsupported },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Provider effective-support summary', className: 'owl-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-ledger-label' }, stat.label),
      createElement('p', { className: `owl-ledger-figure ${stat.figureClass}`.trim() }, String(stat.value)),
    )),
  )
}

function createGlossary() {
  return createElement(
    'details',
    { className: 'owl-section-card' },
    createElement('summary', { style: summaryStyle }, 'Readiness glossary'),
    createElement(
      'dl',
      { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.5rem', margin: 'var(--owl-space-3) 0 0' } },
      ...glossaryEntries.flatMap((entry) => [
        createElement('dt', { key: `${entry.term}-term`, style: { color: 'var(--owl-color-text)', fontWeight: 700 } }, entry.term),
        createElement('dd', { key: `${entry.term}-definition`, style: { margin: 0 } }, entry.definition),
      ]),
    ),
  )
}

// ── Investment-grade groups ───────────────────────────────────────────────────

const investmentGradeGroups: Array<{ key: ProviderInvestmentGrade; accent: string; title: string; description: string }> = [
  {
    key: 'suitable',
    accent: 'Trusted for research',
    title: 'Investment-grade (certified)',
    description: 'Candidates whose latest certification report passes the grounded-research gate. Today this is the audited demo slice only; no live research provider is certified yet.',
  },
  {
    key: 'candidate',
    accent: 'Under evaluation',
    title: 'Frontier candidates (experimental)',
    description: 'Curated frontier reasoning/grounding providers that could become investment-grade once a certification report passes. They stay experimental and fail-closed until then.',
  },
  {
    key: 'not-suitable',
    accent: 'Not for research',
    title: 'Other / unsupported',
    description: 'Providers not flagged as investment-grade candidates, or otherwise unsupported for research.',
  },
]

function investmentGradeOf(row: ProviderStatusRow): ProviderInvestmentGrade {
  if (row.investment_grade !== undefined) {
    return row.investment_grade
  }
  return row.investment_grade_candidate === true ? 'candidate' : 'not-suitable'
}

function renderProviderGroups(rows: ProviderStatusRow[]) {
  return investmentGradeGroups
    .map((group) => ({ group, groupRows: rows.filter((row) => investmentGradeOf(row) === group.key) }))
    .filter(({ groupRows }) => groupRows.length > 0)
    .map(({ group, groupRows }) =>
      createElement(
        'section',
        { key: `group-${group.key}`, 'aria-label': `${group.title} providers`, className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
        createElement('p', { className: 'owl-section-accent' }, group.accent),
        createElement('h2', { className: 'owl-section-title' }, group.title),
        createElement('p', { className: 'owl-body' }, group.description),
        createElement(
          'div',
          { className: 'owl-row-list' },
          ...groupRows.map(renderProviderRow),
        ),
      ),
    )
}

// ── Investment-grade verdict badge ────────────────────────────────────────────

function investmentGradeBadge(row: ProviderStatusRow) {
  const grade = investmentGradeOf(row)
  const presentation: Record<ProviderInvestmentGrade, { label: string; background: string; border: string; color: string }> = {
    suitable: { label: '✓ suitable for research', background: 'rgba(16, 185, 129, 0.16)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#bbf7d0' },
    candidate: { label: 'candidate — not certified', background: 'rgba(214, 178, 94, 0.16)', border: '1px solid rgba(214, 178, 94, 0.4)', color: 'var(--owl-color-gold-bright)' },
    'not-suitable': { label: 'not suitable for research', background: 'rgba(148, 163, 184, 0.12)', border: '1px solid rgba(148, 163, 184, 0.28)', color: 'var(--owl-color-muted)' },
  }
  const { label, ...tone } = presentation[grade]

  return createElement(
    'span',
    {
      'aria-label': `${row.label} investment-grade status`,
      style: {
        ...tone,
        borderRadius: '999px',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 700,
        letterSpacing: '0.02em',
        padding: '0.2rem 0.65rem',
        whiteSpace: 'nowrap',
      },
    },
    `Investment-grade: ${label}`,
  )
}

// ── Effective-support pill (the gating verdict, front-and-center) ─────────────

function effectiveSupportPill(row: ProviderStatusRow) {
  const tone = supportPillTone(row.effective_support_level)
  return createElement(
    'span',
    {
      style: {
        ...tone,
        borderRadius: '999px',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 700,
        letterSpacing: '0.04em',
        padding: '0.2rem 0.65rem',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      },
    },
    row.effective_support_level,
  )
}

function supportPillTone(level: ProviderStatusRow['effective_support_level']): Pick<CSSProperties, 'background' | 'border' | 'color'> {
  if (level === 'certified') {
    return { background: 'rgba(16, 185, 129, 0.16)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#bbf7d0' }
  }
  if (level === 'unsupported') {
    return { background: 'rgba(248, 113, 113, 0.14)', border: '1px solid rgba(248, 113, 113, 0.4)', color: '#fecaca' }
  }
  return { background: 'rgba(214, 178, 94, 0.14)', border: '1px solid rgba(214, 178, 94, 0.38)', color: 'var(--owl-color-gold-bright)' }
}

// ── A single provider entry (owl-row) ─────────────────────────────────────────

function renderProviderRow(row: ProviderStatusRow) {
  const [primaryStatusRows, secondaryStatusRows] = prioritizeStatusRows(row.status_rows)

  return createElement(
    'article',
    { key: row.provider_id, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main', style: { gap: 'var(--owl-space-2)' } },
      // Name + investment-grade verdict on one line.
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
        createElement('h3', { className: 'owl-row-title', style: { color: 'var(--owl-color-gold-bright)' } }, row.label),
        investmentGradeBadge(row),
      ),
      createElement('p', { className: 'owl-row-helper' }, row.description),
      // The honest guardrail line.
      createElement(
        'section',
        { style: providerGuardrailStyle(row) },
        createElement('strong', null, providerGuardrailHeadline(row)),
        createElement('span', null, providerGuardrailDescription(row)),
        row.readiness_state === 'unready' || row.effective_support_level === 'unsupported'
          ? createElement('span', null, 'To set up credentials, ', createElement('a', { href: '/onboarding', style: { color: 'inherit', textDecoration: 'underline' } }, 'open onboarding'), '.')
          : null,
      ),
      // Primary status (Allowed use / Effective support / Catalog support) — the gating truth.
      createElement(
        'section',
        { 'aria-label': `${row.label} provider primary status`, style: { display: 'grid', gap: '0.45rem' } },
        ...renderStatusRows(primaryStatusRows),
      ),
      // Evidence on demand.
      createElement(
        'details',
        { style: { display: 'grid', gap: '0.5rem' } },
        createElement('summary', { style: summaryStyle }, 'Evidence (readiness rows, certification report, limitations)'),
        createElement(
          'section',
          { 'aria-label': `${row.label} provider evidence readiness rows`, style: { display: 'grid', gap: '0.45rem', marginTop: '0.5rem' } },
          ...renderStatusRows(secondaryStatusRows),
        ),
        createElement(
          'section',
          { style: { marginTop: '0.5rem' } },
          createElement('p', { style: { ...monoLabelStyle, marginBottom: '0.35rem' } }, 'Latest certification report'),
          row.last_certification_report === undefined
            ? createElement('p', { style: subtleTextStyle }, 'Workflow certification: No certification report recorded')
            : renderCertificationReport(row),
        ),
        createElement(
          'section',
          { style: { marginTop: '0.5rem' } },
          createElement('p', { style: { ...monoLabelStyle, marginBottom: '0.35rem' } }, 'Limitations'),
          createElement(
            'ul',
            { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0, paddingLeft: '1.2rem' } },
            ...row.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
          ),
        ),
      ),
    ),
    // Right rail: the effective-support verdict + model role, mono.
    createElement(
      'div',
      { className: 'owl-row-aside', style: { alignItems: 'flex-end', flexDirection: 'column' } },
      effectiveSupportPill(row),
      createElement('p', { style: { ...monoLabelStyle, textAlign: 'right' } }, row.model_role),
    ),
  )
}

// ── Status-row rendering ──────────────────────────────────────────────────────

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

function renderStatusRows(statusRows: Array<ProviderStatusRow['status_rows'][number]>): ReactNode[] {
  return statusRows.map((status) =>
    createElement(
      'div',
      {
        key: status.label,
        style: statusRowStyle(status),
      },
      createElement(
        'p',
        { style: { ...monoValueStyle, color: 'var(--owl-color-text)', fontWeight: 700, margin: 0 } },
        `${status.label}${status.label === 'Effective support' ? ' (gating source of truth)' : ''}: ${status.value}`,
      ),
      createElement('p', { style: subtleTextStyle }, status.description),
    ),
  )
}

function statusRowStyle(status: ProviderStatusRow['status_rows'][number]): CSSProperties {
  const toneStyle: Record<string, Pick<CSSProperties, 'background' | 'border'>> = {
    danger: { background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.3)' },
    neutral: { background: 'var(--owl-color-panel-deep)', border: '1px solid var(--owl-color-border)' },
    success: { background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.26)' },
    warning: { background: 'rgba(214, 178, 94, 0.08)', border: '1px solid rgba(214, 178, 94, 0.24)' },
  }
  const base = status.label === 'Effective support'
    ? { background: 'rgba(22, 163, 74, 0.08)', border: '1px solid var(--owl-color-border-strong)' }
    : toneStyle[status.tone]

  return {
    ...base,
    borderRadius: '0.7rem',
    display: 'grid',
    gap: '0.3rem',
    padding: '0.65rem 0.75rem',
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
    createElement('p', { style: { ...monoValueStyle, ...subtleTextStyle } }, `Report ID: ${report.certification_report_id}`),
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

// ── Guardrail headline / description (honest, fail-closed) ─────────────────────

function isSetupOnly(row: ProviderStatusRow): boolean {
  const allowedUse = row.status_rows.find((statusRow) => statusRow.label === 'Allowed use')?.value ?? ''
  return allowedUse.includes('Setup and readiness discovery only') || row.provider_id === 'gemini-cli'
}

function isBlocked(row: ProviderStatusRow): boolean {
  return !row.is_ready || row.effective_support_level === 'unsupported'
}

function providerGuardrailStyle(row: ProviderStatusRow): CSSProperties {
  const base: CSSProperties = { borderRadius: '0.75rem', display: 'grid', gap: '0.3rem', fontSize: 'var(--owl-text-sm)', padding: '0.7rem 0.85rem' }

  if (isSetupOnly(row)) {
    return { ...base, background: 'rgba(214, 178, 94, 0.1)', border: '1px solid rgba(214, 178, 94, 0.3)', color: 'var(--owl-color-gold-bright)' }
  }

  if (isBlocked(row)) {
    return { ...base, background: 'rgba(248, 113, 113, 0.12)', border: '1px solid rgba(248, 113, 113, 0.34)', color: '#fecaca' }
  }

  if (row.effective_support_level === 'experimental') {
    return { ...base, background: 'rgba(214, 178, 94, 0.1)', border: '1px solid rgba(214, 178, 94, 0.3)', color: 'var(--owl-color-gold-bright)' }
  }

  return { ...base, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.28)', color: '#bbf7d0' }
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

// ── Summary buckets ───────────────────────────────────────────────────────────

type ProviderSummary = {
  effectiveBuckets: {
    certified: number
    experimental: number
    unsupported: number
  }
}

function providerSummaryFrom(rows: ProviderStatusRow[]): ProviderSummary {
  return rows.reduce<ProviderSummary>(
    (summary, row) => ({
      effectiveBuckets: {
        ...summary.effectiveBuckets,
        [row.effective_support_level]: summary.effectiveBuckets[row.effective_support_level] + 1,
      },
    }),
    { effectiveBuckets: { certified: 0, experimental: 0, unsupported: 0 } },
  )
}
