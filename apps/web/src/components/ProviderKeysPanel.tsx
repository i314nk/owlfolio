import { createElement, type CSSProperties, type ReactNode } from 'react'

import type { ProviderStatusRow, ProviderQualificationState } from '../lib/providerStatus'
import { RouteHeader } from './designSystem'
import { StatusBadge, type StatusBadgeTone } from './StatusBadge'

/**
 * The Hermes-pattern `/settings/providers` keys page — three stacked sections
 * plus the onboarding gate. Pure SSR projection: every secret is masked to a
 * tail upstream, so the rendered HTML NEVER contains a raw credential value
 * (acceptance test 6). Set/Edit uses plain server-posting forms (no secret is
 * ever serialized into client state).
 */

export type ProviderKeysEnvFile = {
  path: string
  is_git_ignored: boolean
}

export type ProviderKeysGateItem = {
  id: string
  label: string
  done: boolean
}

export type ProviderKeysGate = {
  items: ProviderKeysGateItem[]
  missing_items: ProviderKeysGateItem[]
  is_complete: boolean
  blocked_reason?: string
}

export type ProviderLoginRow = {
  provider_id: string
  label: string
  /** `Browser login (PKCE)` / `Device code` / `External CLI`. */
  auth_method_label: string
  is_connected: boolean
  /** The exact terminal command to connect (shown with a Copy affordance when not connected). */
  connect_command: string
  reauth_command: string
  token_tail?: string
  credential_path?: string
  is_expired: boolean
  countdown_label: string
  /** CLI-managed subscription logins are read-only here. */
  managed_externally: boolean
}

export type ProviderKeyView = {
  name: string
  description: string
  is_set: boolean
  tail?: string
  advanced?: boolean
}

export type ProviderKeyGroupView = {
  id: string
  label: string
  get_key_url: string
  selectable_in_registry: boolean
  keys: ProviderKeyView[]
}

/** A curated reasoning model suggestion for the per-role selector (reasoning-only by construction). */
export type RoleConfigCuratedModel = {
  model_id: string
  /** Which tiers this model suits (used to mark a model as a good fit for the role's tier). */
  tier_suitability: Array<'T1' | 'T2' | 'T3'>
  note: string
}

/** A provider the per-role selector can target, honestly marked connected/qualified. */
export type RoleConfigProviderOption = {
  provider_id: string
  label: string
  is_connected: boolean
  is_qualified: boolean
  /** Curated reasoning models for this provider (empty when none are curated). */
  curated_models: RoleConfigCuratedModel[]
}

/** One per-role row in the Section B configuration table. */
export type RoleConfigRow = {
  role: string
  tier: 'T1' | 'T2' | 'T3'
  description: string
  resolved_provider_id: string
  resolved_model: string
  resolved_temperature: number
  /** true when an override pinned this role onto a DIFFERENT provider/model than the run's. */
  overridden: boolean
  /** Where the current resolution comes from: a file override / a process-env value / the default-inherit. */
  source: 'file' | 'env' | 'default'
  /** The resolved provider has connected credentials (else the role runs fail-closed). */
  target_provider_connected: boolean
  /** The resolved provider passed golden-set qualification. */
  target_provider_qualified: boolean
  /** The current OWLFOLIO_MODEL_ROLE_<ROLE> value (provider:model@temp), for prefilling the selector. */
  current_value?: string
}

export type ProviderRoleConfigView = {
  registry_version: string
  /** Editorial guidance paragraphs shown atop the table (the owner's "how do I configure tiers?" answer). */
  guidance: string[]
  no_model_note: string
  providers: RoleConfigProviderOption[]
  roles: RoleConfigRow[]
}

export type ProviderKeysPanelProps = {
  envFile: ProviderKeysEnvFile
  onboardingGate: ProviderKeysGate
  loginRows: ProviderLoginRow[]
  llmGroups: ProviderKeyGroupView[]
  toolGroups: ProviderKeyGroupView[]
  roleConfig: ProviderRoleConfigView
  /**
   * Per-provider TRUST & certification rows (folded in from the retired /providers page). Optional so
   * existing callers/tests keep working; when present, a collapsible Trust & certification section is
   * rendered with the honest, fail-closed certification + qualification detail.
   */
  trustRows?: ProviderStatusRow[]
}

const SET_KEY_ENDPOINT = '/api/onboarding/credentials'
const MODEL_ROLE_ENDPOINT = '/api/settings/model-roles'

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
}

const subtleTextStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-sm)',
  lineHeight: 1.5,
  margin: 0,
}

export function ProviderKeysPanel(props: ProviderKeysPanelProps) {
  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-wide' },
    createElement(
      'p',
      { className: 'owl-route-back-row' },
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),
    createElement(RouteHeader, {
      kicker: 'Owlfolio · Settings',
      title: 'Provider keys',
      description: 'Connect logins, set API keys, and configure tool & data keys. Keys are stored in a single local env file (server-only, masked on display) and never enter the ledger, logs, page source, or git — the ledger records only that a provider was connected.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    renderEnvFileHeader(props.envFile),
    renderOnboardingGate(props.onboardingGate),
    renderProviderLoginsSection(props.loginRows),
    renderLlmSection(props.llmGroups, props.roleConfig),
    ...(props.trustRows === undefined ? [] : [renderTrustSection(props.trustRows)]),
    renderToolDataSection(props.toolGroups),
  )
}

// ── Trust & certification (folded in from the retired /providers page) ────────
//
// Honest, fail-closed labeling preserved EXACTLY: certification is bounded by
// data/provider-certifications/*.latest.json, and "readiness is not certification". This is a per-
// provider collapsible section: the summary carries the gating effective-support verdict + qualification
// state; the body holds the certification report (incl. the grounded-research scenario gate) and limits.

function renderTrustSection(rows: ProviderStatusRow[]) {
  const certified = rows.filter((row) => row.effective_support_level === 'certified').length
  return createElement(
    'section',
    { 'aria-label': 'Trust and certification', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    sectionHeader('Trust gate', 'Trust & certification', certified, rows.length, 'certified'),
    createElement(
      'p',
      { className: 'owl-body' },
      'Which models are trusted for investment-grade research, and which are not yet. Certification is '
      + 'bounded by the latest persisted report (data/provider-certifications/*.latest.json); readiness is '
      + 'not certification. Each provider opens its certification + golden-set evidence below.',
    ),
    createElement('div', { className: 'owl-row-list' }, ...rows.map(renderTrustProviderAccordion)),
  )
}

function trustSupportTone(level: ProviderStatusRow['effective_support_level']): Pick<CSSProperties, 'background' | 'border' | 'color'> {
  if (level === 'certified') return { background: 'rgba(16, 185, 129, 0.16)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#bbf7d0' }
  if (level === 'unsupported') return { background: 'rgba(248, 113, 113, 0.14)', border: '1px solid rgba(248, 113, 113, 0.4)', color: '#fecaca' }
  return { background: 'rgba(214, 178, 94, 0.14)', border: '1px solid rgba(214, 178, 94, 0.38)', color: 'var(--owl-color-gold-bright)' }
}

function trustPill(label: string, tone: Pick<CSSProperties, 'background' | 'border' | 'color'>) {
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
        whiteSpace: 'nowrap',
      },
    },
    label,
  )
}

function trustQualificationTone(state: ProviderQualificationState): Pick<CSSProperties, 'background' | 'border' | 'color'> {
  if (state === 'qualified') return { background: 'rgba(16, 185, 129, 0.16)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#bbf7d0' }
  if (state === 'not-qualified') return { background: 'rgba(248, 113, 113, 0.14)', border: '1px solid rgba(248, 113, 113, 0.4)', color: '#fecaca' }
  return { background: 'rgba(148, 163, 184, 0.12)', border: '1px solid rgba(148, 163, 184, 0.28)', color: 'var(--owl-color-muted)' }
}

function renderTrustProviderAccordion(row: ProviderStatusRow) {
  const qualState: ProviderQualificationState = row.qualification?.state ?? 'no-report'
  const qualLabel = qualState === 'qualified' ? '✓ golden-set qualified' : qualState === 'not-qualified' ? 'golden-set: not qualified' : 'golden-set: no report'

  return createElement(
    'details',
    { key: `trust-${row.provider_id}`, className: 'owl-row owl-row-top', style: { display: 'block' } },
    createElement(
      'summary',
      { style: { cursor: 'pointer', display: 'grid', gap: 'var(--owl-space-2)', listStyle: 'none' } },
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
        createElement('span', { 'aria-hidden': 'true', style: { ...monoLabelStyle, color: 'var(--owl-color-gold-bright)' } }, '▸'),
        createElement('h3', { className: 'owl-row-title', style: { color: 'var(--owl-color-gold-bright)', margin: 0 } }, row.label),
        trustPill(row.effective_support_level, trustSupportTone(row.effective_support_level)),
        trustPill(qualLabel, trustQualificationTone(qualState)),
      ),
      // The e2e-/honesty-critical gating line stays visible in the summary.
      createElement(
        'section',
        { 'aria-label': `${row.label} trust primary status`, style: { display: 'grid', gap: '0.3rem' } },
        createElement(
          'p',
          { style: { ...monoValueStyle, fontWeight: 700, margin: 0 } },
          `Effective support (gating source of truth): ${row.effective_support_level}`,
        ),
        createElement('p', { style: { ...monoLabelStyle, textTransform: 'none', letterSpacing: 0 } }, `Catalog support: ${row.catalog_support_level}`),
      ),
      createElement('p', { style: { ...monoLabelStyle, color: 'var(--owl-color-gold-bright)' } }, 'Open certification evidence ▾'),
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: 'var(--owl-space-3)', marginTop: 'var(--owl-space-3)' } },
      // Latest certification report (incl. the grounded-research scenario gate).
      createElement(
        'section',
        { style: { display: 'grid', gap: '0.35rem' } },
        createElement('p', { style: monoLabelStyle }, 'Latest certification report'),
        ...renderTrustCertificationReport(row),
      ),
      // Golden-set qualification (verified-not-assumed; no report = not qualified, fail-closed).
      createElement(
        'section',
        { 'aria-label': `${row.label} golden-set qualification`, style: { display: 'grid', gap: '0.35rem' } },
        createElement('p', { style: monoLabelStyle }, 'Golden-set qualification'),
        createElement('p', { style: monoValueStyle }, trustQualificationLabel(qualState)),
        createElement('p', { style: subtleTextStyle }, row.qualification?.detail ?? 'No qualification report — fail-closed (not qualified for production research).'),
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

function trustQualificationLabel(state: ProviderQualificationState): string {
  if (state === 'qualified') return 'Qualified (golden-set passed)'
  if (state === 'not-qualified') return 'Not qualified (golden-set report did not pass)'
  return 'No qualification report (fail-closed)'
}

function renderTrustCertificationReport(row: ProviderStatusRow): ReactNode[] {
  const report = row.last_certification_report
  if (report === undefined) {
    return [createElement('p', { key: 'no-report', style: subtleTextStyle }, 'Workflow certification: No certification report recorded')]
  }

  const scenarios = report.scenarios
  const passed = scenarios.filter((s) => s.status === 'passed').length
  const failed = scenarios.filter((s) => s.status === 'failed').length
  const skipped = scenarios.filter((s) => s.status === 'skipped').length
  const grounded = scenarios.find((s) => s.scenario_id === 'source-grounded-research-task')
  const groundedLine = grounded === undefined
    ? 'Grounded-research scenario (source-grounded-research-task): not in this report.'
    : `Grounded-research scenario (source-grounded-research-task): ${grounded.status}.`

  return [
    createElement('p', { key: 'id', style: { ...monoValueStyle, ...subtleTextStyle, overflowWrap: 'anywhere' } }, `Report ID: ${report.certification_report_id}`),
    createElement('p', { key: 'run', style: subtleTextStyle }, `Run status: ${report.run_status}`),
    createElement('p', { key: 'gen', style: subtleTextStyle }, `Generated: ${report.generated_at}`),
    createElement('p', { key: 'summary', style: subtleTextStyle }, report.not_run_reason === undefined ? report.summary : `Failure cause: ${report.not_run_reason}`),
    scenarios.length === 0
      ? null
      : createElement('p', { key: 'scenarios', style: { ...monoValueStyle, ...subtleTextStyle } }, `Scenarios: ${passed} passed · ${failed} failed · ${skipped} skipped (of ${scenarios.length}).`),
    createElement('p', { key: 'grounded', style: { ...subtleTextStyle, color: grounded?.status === 'passed' ? '#bbf7d0' : 'var(--owl-color-muted)' } }, groundedLine),
  ]
}

// ── Env-file header ───────────────────────────────────────────────────────────

function renderEnvFileHeader(envFile: ProviderKeysEnvFile) {
  return createElement(
    'section',
    { 'aria-label': 'Env file location', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Local key storage'),
    createElement('p', { style: monoLabelStyle }, 'Env file'),
    createElement('p', { style: monoValueStyle }, envFile.path),
    createElement(
      'p',
      { style: subtleTextStyle },
      envFile.is_git_ignored
        ? 'This path is git-ignored (or outside the repo): keys are stored locally and never committed.'
        : 'WARNING: this path is NOT git-ignored. Move it outside the repo before storing secrets.',
    ),
  )
}

// ── Onboarding gate ───────────────────────────────────────────────────────────

function renderOnboardingGate(gate: ProviderKeysGate) {
  const doneCount = gate.items.filter((item) => item.done).length
  return createElement(
    'section',
    { 'aria-label': 'Onboarding checklist', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent', style: { margin: 0 } }, 'Get started'),
      counterChip(doneCount, gate.items.length, 'done'),
    ),
    createElement('h2', { className: 'owl-section-title' }, 'Minimal-viable checklist'),
    createElement(
      'p',
      { style: subtleTextStyle },
      gate.is_complete
        ? 'All minimal-viable items are complete — deep dives can start.'
        : gate.blocked_reason ?? 'Complete the checklist below to start a deep dive.',
    ),
    createElement(
      'ul',
      { style: { display: 'grid', gap: 'var(--owl-space-2)', listStyle: 'none', margin: 0, padding: 0 } },
      ...gate.items.map((item) =>
        createElement(
          'li',
          { key: item.id, style: { alignItems: 'center', display: 'flex', gap: 'var(--owl-space-2)' } },
          createElement(StatusBadge, { tone: item.done ? 'success' : 'warning' }, item.done ? '✓ done' : 'missing'),
          createElement('span', { style: monoValueStyle }, item.label),
        ),
      ),
    ),
  )
}

// ── Section A — Provider logins ───────────────────────────────────────────────

function renderProviderLoginsSection(rows: ProviderLoginRow[]) {
  const connectedCount = rows.filter((row) => row.is_connected && !row.is_expired).length
  return createElement(
    'section',
    { 'aria-label': 'Provider logins', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    sectionHeader('Section A', 'Provider logins (OAuth / subscription)', connectedCount, rows.length, 'connected'),
    createElement(
      'p',
      { className: 'owl-body' },
      'Subscription / OAuth logins, equal to API keys. Owlfolio has no in-app OAuth: connect by running the login command in your terminal, then refresh readiness. CLI-managed logins are read-only here.',
    ),
    createElement('div', { className: 'owl-row-list' }, ...rows.map(renderLoginRow)),
  )
}

function renderLoginRow(row: ProviderLoginRow) {
  const statusTone: StatusBadgeTone = row.is_expired ? 'danger' : row.is_connected ? 'success' : 'warning'
  const statusLabel = row.is_expired ? 'Re-auth required' : row.is_connected ? 'Connected' : 'Not connected'

  return createElement(
    'article',
    { key: `login-${row.provider_id}`, 'aria-label': `${row.label} login`, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main', style: { gap: 'var(--owl-space-2)' } },
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
        createElement('h3', { className: 'owl-row-title', style: { color: 'var(--owl-color-gold-bright)', margin: 0 } }, row.label),
        createElement(StatusBadge, { tone: 'neutral' }, row.auth_method_label),
        createElement(StatusBadge, { tone: statusTone }, statusLabel),
        row.managed_externally ? createElement(StatusBadge, { tone: 'manual' }, 'Managed externally') : null,
      ),
      row.token_tail === undefined ? null : createElement('p', { style: monoValueStyle }, `Token ${row.token_tail}`),
      row.credential_path === undefined ? null : createElement('p', { style: subtleTextStyle }, `Credentials: ${row.credential_path}`),
      createElement('p', { style: subtleTextStyle }, `Expiry: ${row.countdown_label}`),
      // Connect / re-auth command with a copy affordance. Not-connected rows show
      // the exact connect command; connected/expired rows show the re-auth command.
      row.managed_externally
        ? createElement('p', { style: subtleTextStyle }, 'This credential is managed externally and is read-only here.')
        : copyCommandRow(!row.is_connected && !row.is_expired ? row.connect_command : row.reauth_command),
    ),
  )
}

// ── Section B — LLM API keys (collapsible) + tier summary ──────────────────────

function renderLlmSection(groups: ProviderKeyGroupView[], roleConfig: ProviderRoleConfigView) {
  const configuredCount = groups.filter((group) => group.keys.some((key) => key.is_set)).length
  return createElement(
    'section',
    { 'aria-label': 'LLM providers', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    sectionHeader('Section B', 'LLM providers (API keys)', configuredCount, groups.length, 'configured'),
    renderModelRoleConfig(roleConfig),
    createElement('div', { className: 'owl-row-list' }, ...groups.map((group) => renderKeyGroup(group, true))),
  )
}

// ── Per-tier model configuration table (the owner's "how do I configure tiers?" answer) ───────────────

const tierToneByTier: Record<RoleConfigRow['tier'], StatusBadgeTone> = {
  T1: 'success',
  T2: 'neutral',
  T3: 'manual',
}

function sourceLabel(row: RoleConfigRow): string {
  if (row.source === 'file') return 'File override'
  if (row.source === 'env') return 'Env override'
  return 'Default (inherits run)'
}

function renderModelRoleConfig(roleConfig: ProviderRoleConfigView) {
  // The provider options summary (honestly marked connected/qualified) — context for the selector.
  const providerSummary = roleConfig.providers
    .map((p) => `${p.label}: ${p.is_connected ? 'connected' : 'not connected'}${p.is_qualified ? ', qualified' : ''}`)
    .join(' · ')

  return createElement(
    'div',
    { 'aria-label': 'Per-tier model configuration', style: { background: 'var(--owl-color-panel-deep)', border: '1px solid var(--owl-color-border)', borderRadius: '0.7rem', display: 'grid', gap: 'var(--owl-space-3)', padding: '0.85rem 0.95rem' } },
    createElement('p', { style: monoLabelStyle }, `Model tiers · registry ${roleConfig.registry_version}`),
    // ── C. Guidance block (the tier philosophy, in the design system's editorial voice) ──
    createElement(
      'div',
      { style: { display: 'grid', gap: 'var(--owl-space-2)' } },
      ...roleConfig.guidance.map((paragraph, index) =>
        createElement('p', { key: `guidance-${index}`, style: subtleTextStyle }, paragraph),
      ),
    ),
    providerSummary.length === 0 ? null : createElement('p', { style: { ...monoLabelStyle, textTransform: 'none', letterSpacing: 0 } }, `Providers — ${providerSummary}`),
    // ── B. The per-role configuration table ──
    createElement(
      'div',
      { style: { display: 'grid', gap: 'var(--owl-space-3)' } },
      ...roleConfig.roles.map((row) => renderRoleConfigRow(row, roleConfig.providers)),
    ),
    createElement('p', { style: subtleTextStyle }, roleConfig.no_model_note),
  )
}

function renderRoleConfigRow(row: RoleConfigRow, providers: RoleConfigProviderOption[]) {
  // Honest warning: a role whose resolved provider has no connected credentials runs fail-closed.
  const notConnected = !row.target_provider_connected
  const parsed = parseCurrentValue(row.current_value)

  return createElement(
    'article',
    { key: row.role, 'aria-label': `${row.role} model role`, style: { background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: '0.6rem', display: 'grid', gap: 'var(--owl-space-2)', padding: '0.7rem 0.8rem' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement(StatusBadge, { tone: tierToneByTier[row.tier] }, row.tier),
      createElement('span', { style: { ...monoValueStyle, fontWeight: 700 } }, row.role),
      createElement(StatusBadge, { tone: row.source === 'default' ? 'neutral' : 'success' }, sourceLabel(row)),
      notConnected
        ? createElement(StatusBadge, { tone: 'danger' }, 'provider not connected — runs will fail closed')
        : row.target_provider_qualified
          ? createElement(StatusBadge, { tone: 'success' }, 'qualified')
          : createElement(StatusBadge, { tone: 'warning' }, 'not golden-set qualified'),
    ),
    createElement('p', { style: subtleTextStyle }, row.description),
    createElement(
      'p',
      { style: { ...monoLabelStyle, textTransform: 'none', letterSpacing: 0 } },
      `Now: ${row.resolved_provider_id}/${row.resolved_model} @${row.resolved_temperature}`,
    ),
    renderRoleSelectorForm(row, providers, parsed),
  )
}

function parseCurrentValue(value: string | undefined): { provider?: string; model?: string; temperature?: string } {
  if (value === undefined || value.trim().length === 0) return {}
  let rest = value.trim()
  let temperature: string | undefined
  const at = rest.lastIndexOf('@')
  if (at >= 0) {
    temperature = rest.slice(at + 1).trim()
    rest = rest.slice(0, at).trim()
  }
  const colon = rest.indexOf(':')
  const provider = colon >= 0 ? rest.slice(0, colon).trim() : undefined
  const model = colon >= 0 ? rest.slice(colon + 1).trim() : rest
  return { ...(provider === undefined ? {} : { provider }), model, ...(temperature === undefined ? {} : { temperature }) }
}

const roleInputStyle: CSSProperties = {
  background: 'var(--owl-color-panel-deep)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.4rem',
  color: 'var(--owl-color-text)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  padding: '0.35rem 0.55rem',
}

// Providers ordered for the dropdown: CONNECTED first (the spec asks for connected-first grouping), then
// the rest. Stable within each group by the catalog order they arrived in.
function providersConnectedFirst(providers: RoleConfigProviderOption[]): RoleConfigProviderOption[] {
  return [...providers].sort((a, b) => Number(b.is_connected) - Number(a.is_connected))
}

/** True when the parsed model value is a curated reasoning model for the parsed provider. */
function isCuratedSelection(
  providers: RoleConfigProviderOption[],
  parsed: { provider?: string; model?: string },
): boolean {
  if (parsed.provider === undefined || parsed.model === undefined || parsed.model.length === 0) return false
  const provider = providers.find((p) => p.provider_id === parsed.provider)
  return provider?.curated_models.some((m) => m.model_id === parsed.model) ?? false
}

function renderRoleSelectorForm(
  row: RoleConfigRow,
  providers: RoleConfigProviderOption[],
  parsed: { provider?: string; model?: string; temperature?: string },
) {
  const ordered = providersConnectedFirst(providers)
  const datalistId = `curated-models-${row.role}`
  // The escape-hatch warning: shown when the current value is a free-form (uncurated) model — curated
  // models are reasoning-verified; an uncurated one must be verified to support extended reasoning.
  const usingUncurated = parsed.model !== undefined && parsed.model.length > 0 && !isCuratedSelection(providers, parsed)

  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-2)' } },
    createElement(
    'div',
    { style: { display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
    // Set form: provider dropdown + curated model datalist (free-form escape hatch) + optional temp.
    createElement(
      'form',
      { action: MODEL_ROLE_ENDPOINT, method: 'post', style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('input', { name: 'action', type: 'hidden', value: 'set' }),
      createElement('input', { name: 'role', type: 'hidden', value: row.role }),
      createElement(
        'select',
        { 'aria-label': `${row.role} provider`, name: 'provider', defaultValue: parsed.provider ?? '', style: roleInputStyle, required: true },
        createElement('option', { value: '', disabled: true }, 'Provider…'),
        ...ordered.map((p) =>
          createElement(
            'option',
            { key: p.provider_id, value: p.provider_id },
            `${p.label}${p.is_connected ? '' : ' (not connected)'}${p.is_qualified ? ' ✓' : ''}`,
          ),
        ),
      ),
      // Curated reasoning models feed an autocomplete datalist (grouped by provider via the option label),
      // while the input itself stays free-form — the uncurated escape hatch.
      createElement(
        'datalist',
        { id: datalistId },
        ...ordered.flatMap((p) =>
          p.curated_models.map((m) =>
            createElement('option', {
              key: `${p.provider_id}-${m.model_id}`,
              value: m.model_id,
            }, `${p.label}${m.tier_suitability.includes(row.tier) ? ` · fits ${row.tier}` : ''} — ${m.note}`),
          ),
        ),
      ),
      createElement('input', {
        'aria-label': `${row.role} model`,
        name: 'model',
        type: 'text',
        list: datalistId,
        autoComplete: 'off',
        defaultValue: parsed.model ?? '',
        placeholder: 'curated reasoning model (or type any)',
        required: true,
        style: { ...roleInputStyle, flex: '1 1 9rem' },
      }),
      createElement('input', {
        'aria-label': `${row.role} temperature`,
        name: 'temperature',
        type: 'text',
        inputMode: 'decimal',
        autoComplete: 'off',
        defaultValue: parsed.temperature ?? '',
        placeholder: `temp (${row.resolved_temperature})`,
        style: { ...roleInputStyle, width: '6rem' },
      }),
      createElement('button', { className: 'owl-button owl-button-secondary owl-focusable', type: 'submit' }, 'Set'),
    ),
    // Clear form: restores the default-inherit (only meaningful when an override exists).
    row.source === 'default'
      ? null
      : createElement(
          'form',
          { action: MODEL_ROLE_ENDPOINT, method: 'post' },
          createElement('input', { name: 'action', type: 'hidden', value: 'clear' }),
          createElement('input', { name: 'role', type: 'hidden', value: row.role }),
          createElement('button', { className: 'owl-button owl-button-secondary owl-focusable', type: 'submit' }, 'Clear'),
        ),
    ),
    // Uncurated escape-hatch warning: only when the current model is NOT a curated reasoning model.
    usingUncurated
      ? createElement(
          'p',
          {
            'aria-label': `${row.role} uncurated model warning`,
            style: { ...subtleTextStyle, color: 'var(--owl-color-gold-bright)', margin: 0 },
          },
          '⚠ Uncurated model — verify it supports extended reasoning. Curated models are reasoning/thinking-capable; a free-form id is not checked.',
        )
      : null,
  )
}

// ── Section C — Tool & data keys (collapsible) ────────────────────────────────

function renderToolDataSection(groups: ProviderKeyGroupView[]) {
  const configuredCount = groups.filter((group) => group.keys.some((key) => key.is_set)).length
  return createElement(
    'section',
    { 'aria-label': 'Tool and data keys', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    sectionHeader('Section C', 'Tool & data keys', configuredCount, groups.length, 'configured'),
    createElement(
      'p',
      { className: 'owl-body' },
      'Non-LLM keys: market data, EDGAR user agent, corporate-actions feed, search/scrape. Advanced entries are collapsed by default.',
    ),
    createElement('div', { className: 'owl-row-list' }, ...groups.map((group) => renderKeyGroup(group, false))),
  )
}

// ── A collapsible provider/key group (Sections B + C share this) ──────────────

function renderKeyGroup(group: ProviderKeyGroupView, isLlm: boolean) {
  const setCount = group.keys.filter((key) => key.is_set).length
  const advancedKeys = group.keys.filter((key) => key.advanced === true)
  const standardKeys = group.keys.filter((key) => key.advanced !== true)

  return createElement(
    'details',
    { key: group.id, className: 'owl-row owl-row-top', style: { display: 'block' } },
    createElement(
      'summary',
      { style: { alignItems: 'center', cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)', listStyle: 'none' } },
      createElement('span', { 'aria-hidden': 'true', style: { ...monoLabelStyle, color: 'var(--owl-color-gold-bright)' } }, '▸'),
      createElement('h3', { className: 'owl-row-title', style: { color: 'var(--owl-color-gold-bright)', margin: 0 } }, group.label),
      isLlm && group.selectable_in_registry
        ? createElement(StatusBadge, { tone: 'success' }, 'Selectable in registry')
        : null,
      createElement('span', { style: { ...monoLabelStyle, marginLeft: 'auto' } }, `${setCount} of ${group.keys.length} keys`),
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: 'var(--owl-space-3)', marginTop: 'var(--owl-space-3)' } },
      createElement(
        'a',
        { className: 'owl-back-link owl-focusable', href: group.get_key_url, rel: 'noreferrer', target: '_blank' },
        'Get key ↗',
      ),
      ...standardKeys.map(renderKeyRow),
      ...(advancedKeys.length === 0
        ? []
        : [
            createElement(
              'details',
              { key: `${group.id}-advanced`, style: { display: 'block' } },
              createElement('summary', { style: { color: 'var(--owl-color-gold-bright)', cursor: 'pointer', ...monoLabelStyle } }, 'Show Advanced'),
              createElement('div', { style: { display: 'grid', gap: 'var(--owl-space-3)', marginTop: 'var(--owl-space-2)' } }, ...advancedKeys.map(renderKeyRow)),
            ),
          ]),
    ),
  )
}

function renderKeyRow(key: ProviderKeyView): ReactNode {
  return createElement(
    'div',
    {
      key: key.name,
      style: { background: 'var(--owl-color-panel-deep)', border: '1px solid var(--owl-color-border)', borderRadius: '0.7rem', display: 'grid', gap: '0.45rem', padding: '0.7rem 0.85rem' },
    },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('p', { style: { ...monoValueStyle, fontWeight: 700, margin: 0 } }, key.name),
      createElement(StatusBadge, { tone: key.is_set ? 'success' : 'neutral' }, key.is_set ? 'set' : 'not set'),
      key.is_set && key.tail !== undefined
        ? createElement('span', { style: { ...monoLabelStyle, marginLeft: 'auto' } }, key.tail)
        : null,
    ),
    createElement('p', { style: subtleTextStyle }, key.description),
    // Set/Edit posts the value to a server route. type=password + no value attr →
    // the secret is never echoed back into the page source.
    createElement(
      'form',
      { action: SET_KEY_ENDPOINT, method: 'post', style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('input', { name: 'name', type: 'hidden', value: key.name }),
      createElement('input', {
        'aria-label': `${key.name} value`,
        autoComplete: 'off',
        name: 'value',
        placeholder: key.is_set ? 'Replace stored value' : 'Paste key value',
        type: 'password',
        style: { background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: '0.4rem', color: 'var(--owl-color-text)', flex: '1 1 12rem', fontFamily: 'var(--owl-font-mono)', padding: '0.4rem 0.6rem' },
      }),
      createElement('button', { className: 'owl-button owl-button-secondary owl-focusable', type: 'submit' }, key.is_set ? 'Edit' : 'Set'),
    ),
  )
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function sectionHeader(kicker: string, title: string, count: number, total: number, noun: string) {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-2)' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent', style: { margin: 0 } }, kicker),
      counterChip(count, total, noun),
    ),
    createElement('h2', { className: 'owl-section-title' }, title),
  )
}

function counterChip(count: number, total: number, noun: string) {
  // Honest empty states: a chip is only "success"-toned when at least one is done.
  const tone: StatusBadgeTone = count > 0 ? 'success' : 'neutral'
  return createElement(StatusBadge, { tone }, `${count} of ${total} ${noun}`)
}

function copyCommandRow(command: string) {
  return createElement(
    'div',
    { style: { alignItems: 'center', background: 'var(--owl-color-panel-deep)', border: '1px solid var(--owl-color-border)', borderRadius: '0.5rem', display: 'flex', gap: 'var(--owl-space-2)', padding: '0.45rem 0.65rem' } },
    createElement('code', { style: { ...monoValueStyle, flex: 1 } }, command),
    createElement(CopyButton, { value: command }),
  )
}

// The Copy button carries the command in a data attribute; a small delegated
// client script (ProviderKeysCopyScript) wires the clipboard. The page stays a
// server component, and the copied value is only ever a terminal command —
// never a secret.
function CopyButton({ value }: { value: string }) {
  return createElement('button', {
    className: 'owl-button owl-button-secondary owl-focusable',
    type: 'button',
    'data-owl-copy': value,
  }, 'Copy')
}
