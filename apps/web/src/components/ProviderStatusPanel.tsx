import { createElement, type CSSProperties, type ReactNode } from 'react'

import type {
  ModelRegistrySection,
  ModelRegistryRoleRow,
  ProviderInvestmentGrade,
  ProviderQualificationState,
  ProviderStatusRow,
} from '../lib/providerStatus'
import { RouteHeader, OwlButtonLink } from './designSystem'
import { StatusBadge, type StatusBadgeTone } from './StatusBadge'

export type ProviderStatusPanelProps = {
  rows: ProviderStatusRow[]
  modelRegistry?: ModelRegistrySection
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
 * certification posture (the vital-signs ledger line), then mirrors the
 * Hermes "Keys/env" UX honestly: a "Provider connections" list (the logins
 * pattern — connection chip + the real CLI/key connect path, no fake in-app
 * OAuth) and a per-provider "Models" accordion (the dropdown-per-provider,
 * grouped by investment grade) whose always-visible summary carries the
 * gating effective-support verdict and whose body holds the deep certification
 * evidence. Fail-closed honesty throughout.
 */
export function ProviderStatusPanel({ rows, modelRegistry }: ProviderStatusPanelProps) {
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
      description: 'The trust gate for your agent’s brain: which AI models are certified for investment-grade research, and which are not yet. Connections are listed first (how each model is signed in on this machine), then each provider opens a per-model dossier. Readiness, role suitability, certification evidence, and limitations are shown separately so a local credential does not imply certified investment-decision support. The latest persisted certification report is the source of truth for effective support.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    createCertificationLedgerLine(summary),
    createGlossary(),
    createProviderConnectionsSection(rows),
    ...renderProviderGroups(rows),
    ...(modelRegistry === undefined ? [] : [createModelRegistrySection(modelRegistry)]),
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

// ── Section 1 — Provider connections (the Hermes "logins" pattern) ────────────
//
// Honest adaptation: Owlfolio has NO in-app OAuth. CLI providers are connected
// by running `codex login` / `claude login` / `gemini login` OUTSIDE the app;
// API providers by setting a key in the environment. We render the real
// affordance — connection status + the exact connect command/key + a route to
// the /onboarding flow that verifies (refreshes) readiness — never a fake
// "Sign in" button that does nothing.

type ConnectionState = {
  badgeLabel: string
  badgeTone: StatusBadgeTone
}

function connectionStateFor(row: ProviderStatusRow): ConnectionState {
  if (row.provider_id === 'mock-provider') {
    return { badgeLabel: 'Built in', badgeTone: 'success' }
  }

  if (row.auth_mode === 'api_key') {
    return row.is_ready
      ? { badgeLabel: 'Key detected', badgeTone: 'success' }
      : { badgeLabel: 'Not connected', badgeTone: 'warning' }
  }

  // CLI / cached-session surfaces.
  if (row.is_ready) {
    return { badgeLabel: 'Cached session', badgeTone: 'success' }
  }

  if (row.provider_readiness_state === 'reauth_required') {
    return { badgeLabel: 'Reauth required', badgeTone: 'warning' }
  }

  return { badgeLabel: 'Not connected', badgeTone: 'warning' }
}

/** The honest connect path: the real CLI command or where to put the key. */
function connectPathFor(row: ProviderStatusRow): string {
  if (row.provider_id === 'mock-provider') {
    return 'No connection needed — the deterministic demo provider runs locally with no credentials.'
  }

  if (row.reauth_action !== undefined && row.reauth_action.length > 0) {
    return row.reauth_action
  }

  if (row.auth_mode === 'api_key') {
    return 'Set the provider API key in your environment, then refresh readiness.'
  }

  return 'Run the provider CLI login outside Owlfolio, then refresh readiness.'
}

function createProviderConnectionsSection(rows: ProviderStatusRow[]) {
  // Surfaces a user actually connects: skip the hidden/advanced direct-API
  // candidates that have no onboarding lane, but always include CLI + the
  // built-in demo provider.
  const connectable = rows.filter((row) =>
    row.provider_id === 'mock-provider' || row.auth_mode !== undefined)

  return createElement(
    'section',
    { 'aria-label': 'Provider connections', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Connect your models'),
    createElement('h2', { className: 'owl-section-title' }, 'Provider connections'),
    createElement(
      'p',
      { className: 'owl-body' },
      'How each model is signed in on this machine. Owlfolio has no in-app OAuth: CLI providers are connected by running their login command in your terminal, and direct-API providers by setting a key in the environment. Connect, then verify in onboarding to refresh readiness.',
    ),
    createElement(
      'div',
      { className: 'owl-row-list' },
      ...connectable.map(renderConnectionRow),
    ),
  )
}

function renderConnectionRow(row: ProviderStatusRow) {
  const connection = connectionStateFor(row)
  const isDemo = row.provider_id === 'mock-provider'

  return createElement(
    'article',
    { key: `connection-${row.provider_id}`, 'aria-label': `${row.label} connection`, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main', style: { gap: 'var(--owl-space-2)' } },
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
        createElement('h3', { className: 'owl-row-title', style: { color: 'var(--owl-color-gold-bright)' } }, row.label),
        createElement(StatusBadge, { tone: connection.badgeTone }, connection.badgeLabel),
      ),
      createElement('p', { className: 'owl-row-helper' }, connectPathFor(row)),
    ),
    createElement(
      'div',
      { className: 'owl-row-aside' },
      isDemo
        ? createElement('span', { style: { ...monoLabelStyle, textAlign: 'right' } }, 'No setup required')
        : createElement(OwlButtonLink, { href: '/onboarding', variant: 'secondary' }, 'Connect & refresh readiness'),
    ),
  )
}

// ── Section 2 — Models (per-provider accordion, grouped by investment grade) ──

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
          ...groupRows.map(renderProviderAccordion),
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

// ── Qualification badge (golden-set qualification verdict — fail-closed) ──────

function qualificationBadge(row: ProviderStatusRow) {
  const state: ProviderQualificationState = row.qualification?.state ?? 'no-report'
  const presentation: Record<ProviderQualificationState, { label: string; background: string; border: string; color: string }> = {
    qualified: { label: '✓ golden-set qualified', background: 'rgba(16, 185, 129, 0.16)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#bbf7d0' },
    'not-qualified': { label: 'golden-set: not qualified', background: 'rgba(248, 113, 113, 0.14)', border: '1px solid rgba(248, 113, 113, 0.4)', color: '#fecaca' },
    'no-report': { label: 'golden-set: no report', background: 'rgba(148, 163, 184, 0.12)', border: '1px solid rgba(148, 163, 184, 0.28)', color: 'var(--owl-color-muted)' },
  }
  const { label, ...tone } = presentation[state]

  return createElement(
    'span',
    {
      'aria-label': `${row.label} qualification status`,
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
    `Qualification: ${label}`,
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

// ── A single provider entry — the per-provider accordion (<details>) ──────────
//
// summary (always visible): name + investment-grade badge + effective-support
//   verdict. The "<label> provider primary status" region — including the
//   e2e-asserted "Effective support (gating source of truth): <level>" line —
//   lives in the summary so it is visible without expanding.
// body (on demand): models / model role, the full status rows, the latest
//   certification report (id, run status, scenario pass/fail incl. the
//   grounded-research gate), and limitations.

function renderProviderAccordion(row: ProviderStatusRow) {
  const [primaryStatusRows, secondaryStatusRows] = prioritizeStatusRows(row.status_rows)

  return createElement(
    'details',
    { key: row.provider_id, className: 'owl-row owl-row-top', style: { display: 'block' } },
    createElement(
      'summary',
      { style: { cursor: 'pointer', display: 'grid', gap: 'var(--owl-space-2)', listStyle: 'none' } },
      // Name + investment-grade verdict + effective-support pill + chevron.
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
        createElement('span', { 'aria-hidden': 'true', style: { ...monoLabelStyle, color: 'var(--owl-color-gold-bright)' } }, '▸'),
        createElement('h3', { className: 'owl-row-title', style: { color: 'var(--owl-color-gold-bright)', margin: 0 } }, row.label),
        investmentGradeBadge(row),
        qualificationBadge(row),
        effectiveSupportPill(row),
        createElement('span', { style: { ...monoLabelStyle, marginLeft: 'auto' } }, row.model_role),
      ),
      createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, row.description),
      // The honest guardrail line stays visible in the summary.
      createElement(
        'section',
        { style: providerGuardrailStyle(row) },
        createElement('strong', null, providerGuardrailHeadline(row)),
        createElement('span', null, providerGuardrailDescription(row)),
        row.readiness_state === 'unready' || row.effective_support_level === 'unsupported'
          ? createElement('span', null, 'To set up credentials, ', createElement('a', { href: '/onboarding', style: { color: 'inherit', textDecoration: 'underline' } }, 'open onboarding'), '.')
          : null,
      ),
      // Primary status (Allowed use / Effective support / Catalog support) — the
      // gating truth — MUST be visible (e2e asserts the effective-support line).
      createElement(
        'section',
        { 'aria-label': `${row.label} provider primary status`, style: { display: 'grid', gap: '0.45rem' } },
        ...renderStatusRows(primaryStatusRows),
      ),
      createElement('p', { style: { ...monoLabelStyle, color: 'var(--owl-color-gold-bright)' } }, 'Open the per-model dossier ▾'),
    ),
    // Expanded body: deep evidence.
    createElement(
      'div',
      { style: { display: 'grid', gap: 'var(--owl-space-3)', marginTop: 'var(--owl-space-3)' } },
      // Models / model role.
      createElement(
        'section',
        { style: { display: 'grid', gap: '0.35rem' } },
        createElement('p', { style: monoLabelStyle }, 'Model & role'),
        createElement('p', { style: monoValueStyle }, row.model_role),
        createElement('p', { style: subtleTextStyle }, `Surface ${row.provider_surface_id} · workflow role ${row.workflow_role} · auth ${row.auth_mode ?? 'unknown'}.`),
      ),
      // Full readiness rows.
      createElement(
        'section',
        { 'aria-label': `${row.label} provider evidence readiness rows`, style: { display: 'grid', gap: '0.45rem' } },
        createElement('p', { style: monoLabelStyle }, 'Readiness rows'),
        ...renderStatusRows(secondaryStatusRows),
      ),
      // Latest certification report (incl. the grounded-research scenario gate).
      createElement(
        'section',
        { style: { display: 'grid', gap: '0.35rem' } },
        createElement('p', { style: monoLabelStyle }, 'Latest certification report'),
        row.last_certification_report === undefined
          ? createElement('p', { style: subtleTextStyle }, 'Workflow certification: No certification report recorded')
          : renderCertificationReport(row),
      ),
      // model-tiering: golden-set qualification status (verified-not-assumed; no report = not qualified).
      createElement(
        'section',
        { 'aria-label': `${row.label} golden-set qualification`, style: { display: 'grid', gap: '0.35rem' } },
        createElement('p', { style: monoLabelStyle }, 'Golden-set qualification'),
        createElement('p', { style: monoValueStyle }, qualificationStateLabel(row.qualification?.state ?? 'no-report')),
        createElement('p', { style: subtleTextStyle }, row.qualification?.detail ?? 'No qualification report — fail-closed (not qualified for production research).'),
        row.qualification?.golden_set_version === undefined
          ? null
          : createElement('p', { style: subtleTextStyle }, `Golden set ${row.qualification.golden_set_version}${row.qualification.generated_at === undefined ? '' : ` · generated ${row.qualification.generated_at}`}.`),
      ),
      // Limitations.
      createElement(
        'section',
        { style: { display: 'grid', gap: '0.35rem' } },
        createElement('p', { style: monoLabelStyle }, 'Limitations'),
        createElement(
          'ul',
          { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0, paddingLeft: '1.2rem' } },
          ...row.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
        ),
      ),
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
    renderScenarioSummary(report),
  )
}

function renderScenarioSummary(report: NonNullable<ProviderStatusRow['last_certification_report']>): ReactNode {
  const scenarios = report.scenarios
  if (scenarios.length === 0) {
    return null
  }

  const passed = scenarios.filter((scenario) => scenario.status === 'passed').length
  const failed = scenarios.filter((scenario) => scenario.status === 'failed').length
  const skipped = scenarios.filter((scenario) => scenario.status === 'skipped').length
  const grounded = scenarios.find((scenario) => scenario.scenario_id === 'source-grounded-research-task')
  const groundedLine = grounded === undefined
    ? 'Grounded-research scenario (source-grounded-research-task): not in this report.'
    : `Grounded-research scenario (source-grounded-research-task): ${grounded.status}.`

  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.25rem', marginTop: '0.35rem' } },
    createElement('p', { style: { ...monoValueStyle, ...subtleTextStyle } }, `Scenarios: ${passed} passed · ${failed} failed · ${skipped} skipped (of ${scenarios.length}).`),
    createElement('p', { style: { ...subtleTextStyle, color: grounded?.status === 'passed' ? '#bbf7d0' : 'var(--owl-color-muted)' } }, groundedLine),
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

function qualificationStateLabel(state: ProviderQualificationState): string {
  if (state === 'qualified') return 'Qualified (golden-set passed)'
  if (state === 'not-qualified') return 'Not qualified (golden-set report did not pass)'
  return 'No qualification report (fail-closed)'
}

// ── Model registry & tiers (role → resolved provider/model → tier) ────────────
//
// model-tiering-spec: "models are config, not code." This section shows how each swarm ROLE resolves to
// a concrete provider/model + its tier (T1 frontier / T2 mid / T3 cheap-local), plus the low-temperature
// discipline (0–0.3 everywhere — re-run consistency, not creativity) and the T0 "no model, ever" note.

const tierLabels: Record<ModelRegistryRoleRow['tier'], string> = {
  T0: 'T0 · No model (code)',
  T1: 'T1 · Frontier',
  T2: 'T2 · Mid',
  T3: 'T3 · Cheap/Local',
}

function tierTone(tier: ModelRegistryRoleRow['tier']): Pick<CSSProperties, 'background' | 'border' | 'color'> {
  if (tier === 'T1') return { background: 'rgba(214, 178, 94, 0.16)', border: '1px solid rgba(214, 178, 94, 0.4)', color: 'var(--owl-color-gold-bright)' }
  if (tier === 'T2') return { background: 'rgba(96, 165, 250, 0.14)', border: '1px solid rgba(96, 165, 250, 0.38)', color: '#bfdbfe' }
  return { background: 'rgba(148, 163, 184, 0.12)', border: '1px solid rgba(148, 163, 184, 0.28)', color: 'var(--owl-color-muted)' }
}

function createModelRegistrySection(registry: ModelRegistrySection) {
  return createElement(
    'section',
    { 'aria-label': 'Model registry and tiers', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Models are config, not code'),
    createElement('h2', { className: 'owl-section-title' }, 'Model registry & tiers'),
    createElement(
      'p',
      { className: 'owl-body' },
      `The single place that maps each swarm role to a provider/model + tier (registry ${registry.version}). `
      + 'Every role inherits the active run’s provider/model unless an override pins a different one; '
      + 'temperature stays low (0–0.3) everywhere for re-run consistency. Swapping a model is one line.',
    ),
    createElement(
      'div',
      { className: 'owl-row-list' },
      ...registry.roles.map(renderRegistryRoleRow),
    ),
    createElement(
      'p',
      { style: { ...subtleTextStyle, marginTop: 'var(--owl-space-2)' } },
      registry.no_model_note,
    ),
  )
}

function renderRegistryRoleRow(role: ModelRegistryRoleRow) {
  return createElement(
    'article',
    { key: `registry-${role.role}`, 'aria-label': `${role.role} registry role`, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main', style: { gap: 'var(--owl-space-2)' } },
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
        createElement('h3', { className: 'owl-row-title', style: { color: 'var(--owl-color-gold-bright)', margin: 0 } }, role.role),
        createElement(
          'span',
          {
            style: {
              ...tierTone(role.tier),
              borderRadius: '999px',
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-2xs)',
              fontWeight: 700,
              letterSpacing: '0.04em',
              padding: '0.2rem 0.65rem',
              whiteSpace: 'nowrap',
            },
          },
          tierLabels[role.tier],
        ),
        role.overridden
          ? createElement(StatusBadge, { tone: 'warning' }, 'overridden')
          : null,
      ),
      createElement('p', { style: { ...monoValueStyle, margin: 0 } }, `${role.provider_id} / ${role.model} · temp ${role.temperature.toFixed(1)}`),
      createElement('p', { className: 'owl-row-helper' }, role.description),
    ),
  )
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
    (summary, row) => {
      const level = row.effective_support_level
      // Guard against an unknown bucket key: incrementing `undefined + 1` would silently yield NaN.
      // Only count rows whose level is one of the known buckets; skip anything unexpected.
      if (level !== 'certified' && level !== 'experimental' && level !== 'unsupported') {
        return summary
      }
      return {
        effectiveBuckets: {
          ...summary.effectiveBuckets,
          [level]: summary.effectiveBuckets[level] + 1,
        },
      }
    },
    { effectiveBuckets: { certified: 0, experimental: 0, unsupported: 0 } },
  )
}
