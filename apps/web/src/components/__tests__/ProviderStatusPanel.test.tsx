import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ProviderStatusPanel } from '../ProviderStatusPanel'
import type { ProviderStatusRow } from '../../lib/providerStatus'

const rows: ProviderStatusRow[] = [
  {
    provider_id: 'mock-provider',
    label: 'Mock provider',
    description: 'Deterministic demo provider for the audited Buffett-Munger vertical slice.',
    catalog_support_level: 'certified',
    effective_support_level: 'certified',
    readiness_state: 'supported',
    is_ready: true,
    auth_source: 'built-in demo mode',
    status_label: 'Locally runnable through built-in deterministic demo mode',
    model_role: 'Demo/e2e deterministic fixture',
    limitations: ['Never present as real research intelligence.'],
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'native',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'native',
    },
    status_rows: [
      { label: 'Local availability', value: 'Locally runnable', tone: 'success', description: 'Locally runnable through built-in deterministic demo mode' },
      { label: 'Credential status', value: 'Built-in demo provider', tone: 'success', description: 'No external credentials required.' },
      { label: 'Catalog support', value: 'certified', tone: 'success', description: 'Static provider matrix claim.' },
      { label: 'Effective support', value: 'certified', tone: 'success', description: 'Gating source of truth from latest certification evidence.' },
      { label: 'Workflow certification', value: 'Report completed', tone: 'success', description: '12/12 scenarios passed; provider support level is certified.' },
      { label: 'Allowed use', value: 'Demo/e2e deterministic fixture only', tone: 'neutral', description: 'Certified deterministic demo coverage does not imply live investment readiness.' },
    ],
    last_certification_report: {
      certification_report_id: 'cert_mock-provider_2026-06-01T00:00:00.000Z',
      provider_id: 'mock-provider',
      run_status: 'completed',
      support_level: 'certified',
      generated_at: '2026-06-01T00:00:00.000Z',
      summary: '12/12 scenarios passed; provider support level is certified.',
    },
  },
  {
    provider_id: 'claude',
    label: 'Claude',
    description: 'CLI-backed real provider path behind readiness and certification checks.',
    catalog_support_level: 'experimental',
    effective_support_level: 'unsupported',
    readiness_state: 'unready',
    is_ready: false,
    auth_source: 'certification report',
    status_label: 'Claude subscription access disabled',
    model_role: 'Personal-local research/dev fallback',
    limitations: ['CLI-backed provider; no full workflow certification report recorded.'],
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'adapter',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
    },
    status_rows: [
      { label: 'Local availability', value: 'Locally runnable', tone: 'success', description: 'Locally runnable via Claude subscription credentials' },
      { label: 'Credential status', value: 'Credentials blocked by latest certification report', tone: 'danger', description: 'Claude subscription access disabled' },
      { label: 'Catalog support', value: 'experimental', tone: 'warning', description: 'Static provider matrix claim.' },
      { label: 'Effective support', value: 'unsupported', tone: 'danger', description: 'Gating source of truth from latest certification evidence.' },
      { label: 'Workflow certification', value: 'Report not configured', tone: 'danger', description: 'Claude subscription access disabled' },
      { label: 'Allowed use', value: 'Blocked for provider-backed workflow starts', tone: 'danger', description: 'Fail-closed until local availability and effective workflow support are both present.' },
    ],
    last_certification_report: {
      certification_report_id: 'cert_claude_2026-06-01T00-00-00-000Z_not-configured',
      provider_id: 'claude',
      run_status: 'not-configured',
      not_run_reason: 'Claude subscription access disabled',
      support_level: 'unsupported',
      generated_at: '2026-06-01T00:00:00.000Z',
      summary: 'Certification not run: Claude subscription access disabled. Provider support level is unsupported.',
    },
  },
  {
    provider_id: 'openai',
    label: 'OpenAI Codex',
    description: 'Codex CLI-backed real provider path behind readiness and certification checks.',
    catalog_support_level: 'experimental',
    effective_support_level: 'experimental',
    readiness_state: 'experimental',
    is_ready: true,
    auth_source: 'Codex OAuth credentials',
    status_label: 'Locally runnable via Codex OAuth credentials',
    model_role: 'Personal-local research/dev fallback',
    limitations: ['No full workflow certification report recorded.'],
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'adapter',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
    },
    status_rows: [
      { label: 'Local availability', value: 'Locally runnable', tone: 'success', description: 'Locally runnable via Codex OAuth credentials' },
      { label: 'Credential status', value: 'Credentials detected via Codex OAuth credentials', tone: 'success', description: 'Locally runnable via Codex OAuth credentials' },
      { label: 'Catalog support', value: 'experimental', tone: 'warning', description: 'Static provider matrix claim.' },
      { label: 'Effective support', value: 'experimental', tone: 'warning', description: 'Gating source of truth from latest certification evidence.' },
      { label: 'Workflow certification', value: 'No certification report recorded', tone: 'warning', description: 'No persisted certification evidence exists for this provider.' },
      { label: 'Allowed use', value: 'Research drafts only; not certified for final investment or Shariah decisions', tone: 'warning', description: 'Experimental support may assist drafts but is not certified workflow authority.' },
    ],
    last_certification_report: undefined,
  },
]

describe('ProviderStatusPanel', () => {
  it('renders readiness, support, role, latest certification report, and limitations honestly', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Provider status')
    expect(html).toContain('T2 provider certification report format')
    expect(html).toContain('T3 provider/model support matrix')
    expect(html).toContain('Mock provider')
    expect(html).toContain('Locally runnable through built-in deterministic demo mode')
    expect(html).toContain('Effective support (gating source of truth): certified')
    expect(html).toContain('Demo/e2e deterministic fixture')
    expect(html).toContain('cert_mock-provider_2026-06-01T00:00:00.000Z')
    expect(html).toContain('Run status: completed')
    expect(html).toContain('12/12 scenarios passed')
    expect(html).toContain('Never present as real research intelligence.')

    expect(html).toContain('Claude')
    expect(html).toContain('Claude subscription access disabled')
    expect(html).toContain('Effective support (gating source of truth): unsupported')
    expect(html).toContain('Run status: not-configured')
    expect(html).not.toContain('Not-run reason: Claude subscription access disabled')
    expect(html).toContain('Failure cause: Claude subscription access disabled')
    expect(html).toContain('CLI-backed provider; no full workflow certification report recorded.')

    expect(html).toContain('OpenAI Codex')
    expect(html).toContain('Locally runnable via Codex OAuth credentials')
    expect(html).toContain('Workflow certification: No certification report recorded')
    expect(html).not.toContain('#047857')
    expect(html).not.toContain('#ecfdf5')
    expect(html).not.toContain('#f0fdf4')
  })

  it('renders category-labeled status rows instead of ambiguous unlabeled ready badges', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Local availability: Locally runnable')
    expect(html).toContain('Credential status: Built-in demo provider')
    expect(html).toContain('Credential status: Credentials blocked by latest certification report')
    expect(html).toContain('Credential status: Credentials detected via Codex OAuth credentials')
    expect(html).toContain('Catalog support: experimental')
    expect(html).toContain('Effective support (gating source of truth): experimental')
    expect(html).toContain('Workflow certification: Report completed')
    expect(html).toContain('Workflow certification: Report not configured')
    expect(html).toContain('Allowed use: Demo/e2e deterministic fixture only')
    expect(html).toContain('Allowed use: Blocked for provider-backed workflow starts')
    expect(html).toContain('Allowed use: Research drafts only; not certified for final investment or Shariah decisions')
    expect(html).not.toContain('>ready</span>')
    expect(html).not.toContain('>not ready</span>')
  })

  it('renders a concise readiness glossary for provider status terms', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Readiness glossary')
    expect(html).toContain('Demo certified means only the mock provider has passed deterministic demo/e2e workflow certification; it is not live research capability.')
    expect(html).toContain('OAuth/session not signed in means a CLI or account-backed integration has no usable local session token for this machine.')
    expect(html).toContain('Subscription unknown/detected separates account-session presence from paid API billing or workflow certification.')
    expect(html).toContain('Quota/rate limited means credentials may exist but a provider run should remain blocked or retried until budget recovers.')
    expect(html).toContain('Local availability means credentials or built-in demo mode are available to run on this machine; it is not workflow certification.')
    expect(html).toContain('Certified means the latest persisted certification report passed the full workflow.')
    expect(html).toContain('Experimental means catalog support exists but full workflow certification is not proven.')
    expect(html).toContain('Unsupported means the latest report or catalog blocks provider-backed workflow starts.')
    expect(html).toContain('Catalog support is the static provider matrix claim.')
    expect(html).toContain('Effective support is the latest certification-bounded support level used for gating.')
  })

  it('summarizes usable, blocked, experimental, and demo-only providers before report details', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Provider readiness summary')
    expect(html).toContain('Demo-only: 1')
    expect(html).toContain('Blocked: 1')
    expect(html).toContain('Experimental: 1')
    expect(html).toContain('Certified live: 0')
    expect(html).toContain('OpenAI Codex is guarded: research drafts only until certification evidence passes.')
    expect(html).toContain('Claude is blocked: Claude subscription access disabled')
    expect(html).toContain('Action: configure credentials, refresh readiness, or rerun certification after remediation.')
  })

  it('does not repeat not-configured failure prose in report details', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Failure cause: Claude subscription access disabled')
    expect(html).not.toContain('Certification not run: Claude subscription access disabled')
    expect(html).toContain('Technical detail: latest report marked provider support unsupported.')
  })
})
