import { createElement, type CSSProperties, type ReactNode } from 'react'

import { RouteHeader } from './designSystem'
import type { OwlLocale } from '@owlfolio/shared/appConfig'

import { StatusBadge, type StatusBadgeTone } from './StatusBadge'
import { englishContentNote, t, type MessageKey } from '../lib/i18n'

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
  /**
   * The key's RUNTIME state: 'active' (the running server has this value), 'stale_changed' (the file
   * changed after boot — the server still runs the OLD value), 'not_loaded' (saved after boot — the
   * server has NO value), 'absent'. Keys hydrate only at startup, so stale/not-loaded need a restart.
   */
  runtime_state?: 'active' | 'stale_changed' | 'not_loaded' | 'absent'
}

export type ProviderKeyGroupView = {
  id: string
  label: string
  get_key_url: string
  selectable_in_registry: boolean
  keys: ProviderKeyView[]
}

export type ProviderKeysPanelProps = {
  envFile: ProviderKeysEnvFile
  onboardingGate: ProviderKeysGate
  loginRows: ProviderLoginRow[]
  llmGroups: ProviderKeyGroupView[]
  locale?: OwlLocale
}

// i18n: render-scoped locale — page chrome follows the locale; key names, readiness strings, and
// control internals stay English until properly translated (the english-content note says so).
let panelLocale: OwlLocale = 'en'
const dt = (key: MessageKey): string => t(panelLocale, key)

const SET_KEY_ENDPOINT = '/api/onboarding/credentials'

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
  panelLocale = props.locale ?? 'en'
  const note = englishContentNote(panelLocale)
  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-wide' },
    createElement(
      'p',
      { className: 'owl-route-back-row' },
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),
    createElement(RouteHeader, {
      kicker: dt('sp_kicker'),
      title: dt('sp_title'),
      description: dt('sp_desc'),
    }),
    createElement('hr', { className: 'owl-rule' }),
    note === undefined ? null : createElement(
      'p',
      { 'data-testid': 'english-content-note', dir: 'rtl', className: 'owl-row-helper', style: { border: '1px solid var(--owl-color-border)', borderRadius: '0.6rem', margin: '1rem 0 0', padding: '0.6rem 0.8rem' } },
      note,
    ),
    renderEnvFileHeader(props.envFile),
    renderOnboardingGate(props.onboardingGate),
    renderProviderLoginsSection(props.loginRows),
    renderLlmSection(props.llmGroups),
  )
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
          { key: item.id, style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
          createElement(StatusBadge, { tone: item.done ? 'success' : 'warning' }, item.done ? '✓ done' : 'missing'),
          createElement('span', { style: monoValueStyle }, item.label),
          // Investable capital is set on the Portfolio page (not here) — link to it when outstanding.
        ),
      ),
    ),
  )
}

// ── Section A — Provider logins ───────────────────────────────────────────────

function renderProviderLoginsSection(rows: ProviderLoginRow[]) {
  // No CLI/OAuth login providers remain (Codex / Claude CLI / Gemini CLI retired) — surviving providers are
  // API-key surfaces shown in Section B. Render nothing rather than an empty "Provider logins (OAuth)" card,
  // which would otherwise advertise a connection lane the product no longer has.
  if (rows.length === 0) {
    return null
  }
  const connectedCount = rows.filter((row) => row.is_connected && !row.is_expired).length
  return createElement(
    'section',
    { 'aria-label': 'Provider logins', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    sectionHeader('Section A', 'Provider logins (OAuth / subscription)', connectedCount, rows.length, 'connected'),
    createElement(
      'p',
      { className: 'owl-body' },
      'Subscription / OAuth logins, equal to API keys. Owner’s Manual has no in-app OAuth: connect by running the login command in your terminal, then re-check readiness here. CLI-managed logins are read-only here.',
    ),
    refreshStatusButton('Ran a login command in your terminal? Re-check connection status.'),
    createElement('div', { className: 'owl-row-list' }, ...rows.map(renderLoginRow)),
  )
}

// A small client-wired control that re-runs the server-side readiness check by reloading the page. The
// page is force-dynamic, so a reload re-resolves every login/key status. Wired in ProviderKeysCopyScript
// via the `data-owl-refresh` hook (no extra client island).
function refreshStatusButton(hint: string) {
  return createElement(
    'div',
    { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
    createElement(
      'button',
      {
        type: 'button',
        'data-owl-refresh': '1',
        className: 'owl-focusable',
        style: {
          background: 'var(--owl-color-panel-deep)',
          border: '1px solid var(--owl-color-border-strong)',
          borderRadius: '0.5rem',
          color: 'var(--owl-color-gold-bright)',
          cursor: 'pointer',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: 'var(--owl-text-xs)',
          fontWeight: 700,
          padding: '0.35rem 0.8rem',
        },
      },
      'Refresh status ↻',
    ),
    createElement('span', { style: subtleTextStyle }, hint),
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

// ── Section B — LLM API keys (collapsible) ───────────────────────────────────

function renderLlmSection(groups: ProviderKeyGroupView[]) {
  const configuredCount = groups.filter((group) => group.keys.some((key) => key.is_set)).length
  return createElement(
    'section',
    { 'aria-label': 'LLM providers', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    sectionHeader('Section B', 'LLM providers (API keys)', configuredCount, groups.length, 'configured'),
    createElement('div', { className: 'owl-row-list' }, ...groups.map((group) => renderKeyGroup(group, true))),
    // SINGLE-MODEL (owner, 2026-07-18): model tiering and per-role overrides were removed. The ONE
    // model that runs every stage of the analysis is chosen in the guided setup above — the analysis
    // is only as good as that model.
    createElement(
      'p',
      { style: subtleTextStyle },
      'One model runs the whole analysis — pick it in the guided setup above. Deterministic work (valuation math, Shariah ratio verification, purification arithmetic, scheduling, 13F/EDGAR parsing) is pure code and never uses a model.',
    ),
  )
}

// ── A collapsible provider/key group (Section B uses this) ────────────────────

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
      // Restart-to-apply signal: the file says one thing, the running server another (keys hydrate
      // only at boot). Without this chip the page reads "set/connected" while a run would fail.
      key.runtime_state === 'stale_changed' || key.runtime_state === 'not_loaded'
        ? createElement(StatusBadge, { tone: 'warning' }, 'saved — restart to apply')
        : null,
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
