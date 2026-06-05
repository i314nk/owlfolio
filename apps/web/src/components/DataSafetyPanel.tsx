import { createElement } from 'react'

import type { DataSafetyViewModel } from '../lib/dataSafety'
import { OwlCard, PageHeader } from './designSystem'
import { StatusBadge } from './StatusBadge'

export type DataSafetyPanelProps = {
  dataSafety: DataSafetyViewModel
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return createElement(
    'div',
    { className: 'owl-data-safety-metric' },
    createElement('span', { className: 'owl-data-safety-metric-label' }, label),
    createElement('strong', { className: 'owl-data-safety-metric-value' }, String(value)),
  )
}

export function DataSafetyPanel({ dataSafety }: DataSafetyPanelProps) {
  const restoreRewriteRows = dataSafety.restore.path_rewrites.length === 0
    ? [createElement(
      'li',
      { key: 'none' },
      'No app-config path rewrites were detected in the current manifest; restore verification still remains operator-runbook-only.',
    )]
    : dataSafety.restore.path_rewrites.map((rewrite) => createElement(
      'li',
      { key: `${rewrite.field}:${rewrite.from_label}:${rewrite.to_label}` },
      createElement('code', null, rewrite.field),
      ' rewrites ',
      createElement('code', null, rewrite.from_label),
      ' → ',
      createElement('code', null, rewrite.to_label),
    ))

  return createElement(
    'main',
    { className: 'owl-workflow-page owl-data-safety-page' },
    createElement(PageHeader, {
      eyebrow: 'Settings',
      title: 'Settings / Data Safety',
      description: 'Conservative backup and restore visibility for Owlfolio personal-local runtime data. This panel is status and proposal evidence only, not a destructive restore control.',
    }),
    createElement(
      'section',
      { className: 'owl-data-safety-grid', 'aria-label': 'Owlfolio data safety status' },
      createElement(
        OwlCard,
        { eyebrow: 'Privacy boundary', title: 'What backups contain' },
        createElement(
          'p',
          { className: 'owl-muted-copy' },
          'Backups contain investment ledgers, source bundles, provider certification metadata, and app configuration metadata for local workflow continuity.',
        ),
        createElement(
          'p',
          { className: 'owl-warning-copy' },
          'They do not include credentials, API keys, provider auth homes, or CLI session files. Re-authenticate providers separately after any operator-managed restore.',
        ),
        createElement(
          'p',
          { className: 'owl-muted-copy' },
          'Research notes, holdings, valuations, Shariah/accounting/purification context, and source evidence can be sensitive investment data; handle backup archives accordingly.',
        ),
      ),
      createElement(
        OwlCard,
        { eyebrow: 'Generated manifest', title: 'Current inventory snapshot' },
        createElement(
          'div',
          { className: 'owl-data-safety-metrics' },
          createElement(Metric, { label: 'Status', value: dataSafety.manifest_available ? 'Manifest generated' : 'Manifest unavailable' }),
          createElement(Metric, { label: 'Generated at', value: dataSafety.generated_at_utc }),
          createElement(Metric, { label: 'Mode', value: dataSafety.mode }),
          createElement(Metric, { label: 'Provider', value: dataSafety.provider_id }),
          createElement(Metric, { label: 'Files in manifest', value: dataSafety.manifest_file_count }),
          createElement(Metric, { label: 'Project location', value: dataSafety.project_dir_label }),
        ),
      ),
      createElement(
        OwlCard,
        { eyebrow: 'Included categories', title: 'Allowlisted runtime data' },
        createElement(
          'ul',
          { className: 'owl-data-safety-list' },
          ...dataSafety.included_categories.map((entry) => createElement(
            'li',
            { key: `${entry.label}:${entry.path_label}` },
            createElement('strong', null, entry.label),
            createElement('span', null, entry.path_label),
            createElement('small', null, `${entry.source} — ${entry.reason}`),
          )),
        ),
      ),
      createElement(
        OwlCard,
        { eyebrow: 'Excluded categories', title: 'Credentials and generated state stay out' },
        createElement(
          'ul',
          { className: 'owl-data-safety-list' },
          ...dataSafety.excluded_categories.map((entry) => createElement(
            'li',
            { key: `${entry.pattern}:${entry.reason}` },
            createElement('strong', null, entry.pattern),
            createElement('small', null, entry.reason),
          )),
        ),
      ),
      createElement(
        OwlCard,
        { eyebrow: 'Restore dry-run', title: 'Restore is dry-run/proposal only' },
        createElement(
          'p',
          { className: 'owl-warning-copy' },
          'No destructive restore action is available in the web app. Restore remains an operator-confirmed archive/restore workflow until a reviewed restore flow exists.',
        ),
        createElement(
          'p',
          null,
          createElement(StatusBadge, { tone: 'manual' }, 'Proposal only'),
          ' ',
          dataSafety.restore.verification_status,
        ),
        createElement(
          'div',
          { className: 'owl-data-safety-metrics' },
          createElement(Metric, { label: 'Restore root', value: dataSafety.restore.restore_root_label }),
          createElement(Metric, { label: 'Files', value: dataSafety.restore.counts.files }),
          createElement(Metric, { label: 'Ledgers', value: dataSafety.restore.counts.ledgers }),
          createElement(Metric, { label: 'Source bundles', value: dataSafety.restore.counts.source_bundles }),
          createElement(Metric, { label: 'Provider reports', value: dataSafety.restore.counts.provider_reports }),
        ),
        createElement(
          'ul',
          { className: 'owl-data-safety-list' },
          ...restoreRewriteRows,
        ),
      ),
    ),
  )
}
