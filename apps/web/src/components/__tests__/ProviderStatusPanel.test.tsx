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
    status_label: 'Ready for deterministic demo mode',
    model_role: 'Demo/e2e deterministic fixture',
    limitations: ['Never present as real research intelligence.'],
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'native',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'native',
    },
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
]

describe('ProviderStatusPanel', () => {
  it('renders readiness, support, role, latest certification report, and limitations honestly', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Provider status')
    expect(html).toContain('T2 provider certification report format')
    expect(html).toContain('T3 provider/model support matrix')
    expect(html).toContain('Mock provider')
    expect(html).toContain('Ready for deterministic demo mode')
    expect(html).toContain('Effective support: certified')
    expect(html).toContain('Demo/e2e deterministic fixture')
    expect(html).toContain('cert_mock-provider_2026-06-01T00:00:00.000Z')
    expect(html).toContain('Run status: completed')
    expect(html).toContain('12/12 scenarios passed')
    expect(html).toContain('Never present as real research intelligence.')

    expect(html).toContain('Claude')
    expect(html).toContain('Claude subscription access disabled')
    expect(html).toContain('Effective support: unsupported')
    expect(html).toContain('Run status: not-configured')
    expect(html).not.toContain('Not-run reason: Claude subscription access disabled')
    expect(html).toContain('Certification not run: Claude subscription access disabled')
    expect(html).toContain('CLI-backed provider; no full workflow certification report recorded.')
  })

  it('renders a concise readiness glossary for provider status terms', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Readiness glossary')
    expect(html).toContain('Ready means local credentials or built-in demo mode are available.')
    expect(html).toContain('Certified means the latest persisted certification report passed the full workflow.')
    expect(html).toContain('Experimental means catalog support exists but full workflow certification is not proven.')
    expect(html).toContain('Unsupported means the latest report or catalog blocks provider-backed workflow starts.')
    expect(html).toContain('Catalog support is the static provider matrix claim.')
    expect(html).toContain('Effective support is the latest certification-bounded support level used for gating.')
  })
})
