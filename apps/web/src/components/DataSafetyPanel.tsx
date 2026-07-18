import { createElement, Fragment, type ReactNode } from 'react'

import type { OwlLocale } from '@owlfolio/shared/appConfig'

import type { DataSafetyViewModel } from '../lib/dataSafety'
import { englishContentNote, t, type MessageKey } from '../lib/i18n'
import { BulkResetControl } from './BulkResetControl'
import { RouteHeader } from './designSystem'
import { StatusBadge } from './StatusBadge'

export type DataSafetyPanelProps = {
  dataSafety: DataSafetyViewModel
  /**
   * Server-computed dev-tools gate. When false (normal personal-local operation) the destructive bulk
   * reset control is ABSENT — not a disabled stub.
   */
  bulkResetEnabled?: boolean
  locale?: OwlLocale
}

// i18n: render-scoped locale — page chrome follows the locale; the status surfaces and technical
// vocabulary stay English until properly translated (the english-content note says so off-English).
let panelLocale: OwlLocale = 'en'
const dt = (key: MessageKey): string => t(panelLocale, key)

/** Inline mono path/identifier styling (globals.css is not editable in this lane). */
const codeStyle = {
  color: 'var(--owl-color-gold-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  overflowWrap: 'anywhere' as const,
}

function Code({ children }: { children: ReactNode }) {
  return createElement('code', { style: codeStyle }, children)
}

/**
 * Settings · Data Safety, in the Fiduciary Briefing voice.
 *
 * The page answers three calm questions for the principal: what is stored on
 * your machine, what is in (and deliberately out of) a backup, and what the
 * honest state of restore is today. Local-first and conservative throughout —
 * status and proposal evidence only, never a destructive control.
 */
export function DataSafetyPanel({ dataSafety, bulkResetEnabled = false, locale = 'en' }: DataSafetyPanelProps) {
  panelLocale = locale
  const note = englishContentNote(locale)
  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-narrow owl-data-safety-page' },
    createElement('p', { className: 'owl-route-back-row' },
      // `/settings` is not a route — the back link goes home like every other page.
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),
    createElement(RouteHeader, {
      kicker: dt('sd_kicker'),
      title: dt('sd_title'),
      description: dt('sd_desc'),
    }),
    createElement('hr', { className: 'owl-rule' }),
    note === undefined ? null : createElement(
      'p',
      { 'data-testid': 'english-content-note', dir: 'rtl', className: 'owl-row-helper', style: { border: '1px solid var(--owl-color-border)', borderRadius: '0.6rem', margin: '1rem 0 0', padding: '0.6rem 0.8rem' } },
      note,
    ),
    createPrivacyBoundary(),
    createManifestSnapshot(dataSafety),
    createIncludedCategories(dataSafety),
    createExcludedCategories(dataSafety),
    createRestorePosture(),
    // The destructive wholesale clear is a dev/test tool, visually + textually separated below the calm
    // status surfaces. Rendered ONLY when the server-side gate is enabled; ABSENT in normal operation.
    bulkResetEnabled ? createBulkResetSection() : null,
  )
}

// ── Developer / test tools (destructive, gated) ───────────────────────────────

function createBulkResetSection() {
  return createElement(
    'section',
    { 'aria-label': 'Developer and test tools', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent', style: { color: 'var(--owl-color-risk-bright)' } }, 'Developer / test tools'),
    createElement('h2', { className: 'owl-section-title' }, 'Destructive: clear all local state'),
    createElement(
      'p',
      { className: 'owl-body' },
      'This section is only visible because dev/test tools are enabled in this environment. It is the wholesale clear used for development and tests — it is distinct from, and far blunter than, the append-only single-run archive.',
    ),
    createElement(BulkResetControl),
  )
}

// ── The privacy boundary ──────────────────────────────────────────────────────

function createPrivacyBoundary() {
  return createElement(
    'section',
    { 'aria-label': 'Privacy boundary', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Privacy boundary'),
    createElement('h2', { className: 'owl-section-title' }, 'What a backup contains — and what it never does'),
    createElement(
      'p',
      { className: 'owl-body' },
      'Backups contain investment ledgers, source bundles, provider certification metadata, and app configuration metadata for local workflow continuity.',
    ),
    createElement(
      'div',
      { className: 'owl-row owl-row-top' },
      createElement(
        'div',
        { className: 'owl-row-main' },
        createElement('h3', { className: 'owl-row-title' }, 'Credentials stay out'),
        createElement(
          'p',
          { className: 'owl-row-helper' },
          'They do not include credentials, API keys, provider auth homes, or CLI session files. Re-authenticate providers separately after any operator-managed restore.',
        ),
      ),
      createElement('div', { className: 'owl-row-aside' },
        createElement(StatusBadge, { tone: 'manual' }, 'Excluded by design'),
      ),
    ),
    createElement(
      'p',
      { className: 'owl-body' },
      'Research notes, held theses, valuations, Shariah context, and source evidence can be sensitive investment data; handle backup archives accordingly.',
    ),
    createElement(
      'p',
      { className: 'owl-body' },
      createElement('strong', { style: { color: 'var(--owl-color-text)' } }, 'To back up: '),
      'run ',
      createElement(Code, null, 'corepack pnpm worker -- --once --dry-run --define-defaults'),
      ' to verify state, then archive the paths listed under the allowlisted runtime data below. To restore, unpack the archive into the project workspace and re-authenticate providers — the app never restores automatically.',
    ),
  )
}

// ── The current inventory snapshot ────────────────────────────────────────────

function createManifestSnapshot(dataSafety: DataSafetyViewModel) {
  const stats: { figureClass: string; label: string; value: string }[] = [
    { figureClass: dataSafety.manifest_available ? 'owl-ledger-figure-emerald' : 'owl-ledger-figure-risk', label: 'Manifest', value: dataSafety.manifest_available ? 'Generated' : 'Unavailable' },
    { figureClass: '', label: 'Files in manifest', value: String(dataSafety.manifest_file_count) },
    { figureClass: '', label: 'Included categories', value: String(dataSafety.included_categories.length) },
    { figureClass: '', label: 'Excluded patterns', value: String(dataSafety.excluded_categories.length) },
  ]

  return createElement(
    Fragment,
    null,
    createElement(
      'section',
      { 'aria-label': 'Current inventory snapshot', className: 'owl-ledger-line' },
      ...stats.map((stat) => createElement(
        'article',
        { className: 'owl-ledger-stat', key: stat.label },
        createElement('p', { className: 'owl-ledger-label' }, stat.label),
        createElement('p', { className: `owl-ledger-figure ${stat.figureClass}`.trim() }, stat.value),
      )),
    ),
    createElement(
      'p',
      { className: 'owl-data-safety-snapshot-meta', style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)', margin: 0 } },
      createElement('span', null, 'Generated at '),
      createElement(Code, null, dataSafety.generated_at_utc),
      createElement('span', { 'aria-hidden': 'true' }, '   ·   '),
      createElement('span', null, 'Project '),
      createElement(Code, null, dataSafety.project_dir_label),
    ),
  )
}

// ── Allowlisted runtime data (included) ───────────────────────────────────────

function createIncludedCategories(dataSafety: DataSafetyViewModel) {
  return createElement(
    'section',
    { 'aria-label': 'Allowlisted runtime data', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Included categories'),
    createElement('h2', { className: 'owl-section-title' }, 'Allowlisted runtime data'),
    createElement(
      'div',
      { className: 'owl-row-list' },
      ...dataSafety.included_categories.map((entry) => createElement(
        'div',
        { key: `${entry.label}:${entry.path_label}`, className: 'owl-row owl-row-top' },
        createElement(
          'div',
          { className: 'owl-row-main' },
          createElement('h3', { className: 'owl-row-title' }, entry.label),
          createElement('p', { className: 'owl-row-helper' }, entry.reason),
        ),
        createElement(
          'div',
          { className: 'owl-row-aside' },
          createElement(Code, null, entry.path_label),
        ),
      )),
    ),
  )
}

// ── Excluded categories ───────────────────────────────────────────────────────

function createExcludedCategories(dataSafety: DataSafetyViewModel) {
  return createElement(
    'section',
    { 'aria-label': 'Excluded categories', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Excluded categories'),
    createElement('h2', { className: 'owl-section-title' }, 'Credentials and generated state stay out'),
    createElement(
      'div',
      { className: 'owl-row-list' },
      ...dataSafety.excluded_categories.map((entry) => createElement(
        'div',
        { key: `${entry.pattern}:${entry.reason}`, className: 'owl-row owl-row-top' },
        createElement(
          'div',
          { className: 'owl-row-main' },
          createElement('h3', { className: 'owl-row-title' },
            createElement(Code, null, entry.pattern),
          ),
          createElement('p', { className: 'owl-row-helper' }, entry.reason),
        ),
      )),
    ),
  )
}

// ── Restore posture (operator-only, honest) ───────────────────────────────────

function createRestorePosture() {
  return createElement(
    'section',
    { 'aria-label': 'Restore posture', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Restore'),
    createElement('h2', { className: 'owl-section-title' }, 'Restore is manual \u2014 copy the files back'),
    createElement(
      'p',
      { className: 'owl-body' },
      'To restore, copy the files above back to their paths (or point the ',
      createElement(Code, null, 'OWLFOLIO_*'),
      ' path overrides at the restored copies) and restart the app. For a checksummed manifest and a restore path plan, the ops CLI covers it: ',
      createElement(Code, null, 'corepack pnpm ops:backup:manifest'),
      ', ',
      createElement(Code, null, 'ops:restore:dry-run'),
      ', ',
      createElement(Code, null, 'ops:restore:verify'),
      '.',
    ),
    createElement(
      'p',
      { className: 'owl-body' },
      'Owner\u2019s Manual never restores automatically \u2014 like every other duty, you initiate it. There is no destructive restore control anywhere in the app.',
    ),
  )
}
