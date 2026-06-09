import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ProviderStatusPanel } from '../ProviderStatusPanel'
import type { ProviderStatusRow } from '../../lib/providerStatus'

const rows: ProviderStatusRow[] = [
  {
    provider_id: 'mock-provider',
    provider_surface_id: 'mock-provider',
    vendor_id: 'mock',
    runtime_kind: 'built_in',
    auth_mode: 'built_in_demo',
    workflow_role: 'research_draft',
    billing_mode: 'built_in_demo',
    quota_source: 'built_in',
    quota_status: 'available',
    data_policy_source: 'built_in_demo',
    retention_or_zdr_status: 'not_applicable',
    headless_supported: true,
    scheduled_workflow_supported: true,
    automation_suitability: 'production_headless',
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
      'source-grounding': 'native',
      'citation-metadata': 'native',
      'url-context': 'native',
      'file-context': 'adapter',
      'source-bundle-production': 'native',
      'code-execution': 'unsupported',
      'computer-use': 'unsupported',
      'browser-use': 'unsupported',
    },
    status_rows: [
      { label: 'Surface', value: 'mock-provider', tone: 'neutral', description: 'Mock provider uses vendor mock through the built_in runtime; provider-family claims do not transfer to sibling surfaces.' },
      { label: 'Auth mode', value: 'built_in_demo', tone: 'success', description: 'Credential source category: built_in.' },
      { label: 'Billing/quota', value: 'built_in_demo; quota available', tone: 'success', description: 'Quota source: built_in. Subscription, API billing, and built-in demo quotas are separate readiness claims.' },
      { label: 'Privacy posture', value: 'built_in_demo; not_applicable', tone: 'neutral', description: 'Privacy posture is surface-specific and must not include credential values, raw local paths, cookies, or browser sessions.' },
      { label: 'Role certification', value: 'research_draft: certified', tone: 'success', description: 'Latest target mock-provider / built_in_demo / mock-research-v2 finished with run status completed.' },
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
      target: {
        provider_surface_id: 'mock-provider',
        vendor_id: 'mock',
        runtime_kind: 'built_in',
        auth_mode: 'built_in_demo',
        model_id: 'mock-research-v2',
        workflow_role: 'research_draft',
        schema_version: 1,
      },
      run_status: 'completed',
      support_level: 'certified',
      generated_at: '2026-06-01T00:00:00.000Z',
      summary: '12/12 scenarios passed; provider support level is certified.',
    },
  },
  {
    provider_id: 'claude',
    provider_surface_id: 'claude-cli',
    vendor_id: 'anthropic',
    runtime_kind: 'cli',
    auth_mode: 'cli_cached_session',
    workflow_role: 'research_draft',
    billing_mode: 'subscription_entitlement',
    quota_source: 'subscription_tier',
    quota_status: 'unknown',
    data_policy_source: 'subscription_workspace_policy',
    retention_or_zdr_status: 'not_verified',
    headless_supported: false,
    scheduled_workflow_supported: false,
    automation_suitability: 'personal_local_interactive',
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
      'source-grounding': 'adapter',
      'citation-metadata': 'adapter',
      'url-context': 'unsupported',
      'file-context': 'adapter',
      'source-bundle-production': 'adapter',
      'code-execution': 'unsupported',
      'computer-use': 'unsupported',
      'browser-use': 'unsupported',
    },
    status_rows: [
      { label: 'Surface', value: 'claude-cli', tone: 'neutral', description: 'Claude uses vendor anthropic through the cli runtime; provider-family claims do not transfer to sibling surfaces.' },
      { label: 'Auth mode', value: 'cli_cached_session', tone: 'warning', description: 'Credential source category: configured_secret_file (Claude subscription credentials).' },
      { label: 'Billing/quota', value: 'subscription_entitlement; quota unknown', tone: 'warning', description: 'Quota source: subscription_tier. Subscription, API billing, and built-in demo quotas are separate readiness claims.' },
      { label: 'Privacy posture', value: 'subscription_workspace_policy; not_verified', tone: 'warning', description: 'Privacy posture is surface-specific and must not include credential values, raw local paths, cookies, or browser sessions.' },
      { label: 'Role certification', value: 'research_draft: unsupported', tone: 'danger', description: 'Latest target claude-cli / cli_cached_session / claude-sonnet-4-6 finished with run status not-configured.' },
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
      target: {
        provider_surface_id: 'claude-cli',
        vendor_id: 'anthropic',
        runtime_kind: 'cli',
        auth_mode: 'cli_cached_session',
        model_id: 'claude-sonnet-4-6',
        workflow_role: 'research_draft',
        schema_version: 1,
      },
      run_status: 'not-configured',
      not_run_reason: 'Claude subscription access disabled',
      support_level: 'unsupported',
      generated_at: '2026-06-01T00:00:00.000Z',
      summary: 'Certification not run: Claude subscription access disabled. Provider support level is unsupported.',
    },
  },
  {
    provider_id: 'openai',
    provider_surface_id: 'openai-codex-cli',
    vendor_id: 'openai',
    runtime_kind: 'cli',
    auth_mode: 'cli_cached_session',
    workflow_role: 'research_draft',
    billing_mode: 'subscription_entitlement',
    quota_source: 'subscription_tier',
    quota_status: 'unknown',
    data_policy_source: 'subscription_workspace_policy',
    retention_or_zdr_status: 'not_verified',
    headless_supported: false,
    scheduled_workflow_supported: false,
    automation_suitability: 'personal_local_interactive',
    label: 'OpenAI Codex',
    description: 'Codex CLI-backed real provider path behind readiness and certification checks.',
    catalog_support_level: 'experimental',
    effective_support_level: 'unsupported',
    readiness_state: 'unready',
    is_ready: false,
    auth_source: 'certification report',
    status_label: 'OpenAI workflow support is unsupported until reauthentication and report refresh',
    model_role: 'Personal-local research/dev fallback',
    limitations: ['No full workflow certification report recorded.', 'Execution remains blocked until reauthentication and support evidence are refreshed.'],
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'adapter',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
      'source-grounding': 'adapter',
      'citation-metadata': 'adapter',
      'url-context': 'unsupported',
      'file-context': 'adapter',
      'source-bundle-production': 'adapter',
      'code-execution': 'unsupported',
      'computer-use': 'unsupported',
      'browser-use': 'unsupported',
    },
    status_rows: [
      { label: 'Surface', value: 'openai-codex-cli', tone: 'neutral', description: 'OpenAI Codex CLI uses vendor openai through the cli runtime; provider-family claims do not transfer to sibling surfaces.' },
      { label: 'Auth mode', value: 'cli_cached_session', tone: 'warning', description: 'Credential source category: configured_secret_file (Codex OAuth credentials).' },
      { label: 'Billing/quota', value: 'subscription_entitlement; quota unknown', tone: 'warning', description: 'Quota source: subscription_tier. Subscription, API billing, and built-in demo quotas are separate readiness claims.' },
      { label: 'Privacy posture', value: 'subscription_workspace_policy; not_verified', tone: 'warning', description: 'Privacy posture is surface-specific and must not include credential values, raw local paths, cookies, or browser sessions.' },
      { label: 'Role certification', value: 'research_draft: unsupported', tone: 'danger', description: 'No matching report supports certified workflow starts for this target.' },
      { label: 'Local availability', value: 'Locally unavailable', tone: 'danger', description: 'Local auth state is not usable for workflow starts until reauthentication is completed.' },
      { label: 'Credential status', value: 'Credentials blocked by latest certification report', tone: 'danger', description: 'OpenAI credentials are blocked until reauth and certification refresh completes.' },
      { label: 'Catalog support', value: 'experimental', tone: 'warning', description: 'Static provider matrix claim.' },
      { label: 'Effective support', value: 'unsupported', tone: 'danger', description: 'Gating source of truth from latest certification evidence.' },
      { label: 'Workflow certification', value: 'Report not configured', tone: 'danger', description: 'Reauthenticate and rerun certification for this target.' },
      { label: 'Allowed use', value: 'Blocked for provider-backed workflow starts', tone: 'danger', description: 'Allowed use remains blocked until local availability and effective support recover.' },
    ],
    last_certification_report: {
      certification_report_id: 'cert_openai_2026-06-01T00-00-00-000Z_not-configured',
      provider_id: 'openai',
      target: {
        provider_surface_id: 'openai-codex-cli',
        vendor_id: 'openai',
        runtime_kind: 'cli',
        auth_mode: 'cli_cached_session',
        model_id: 'openai-gpt-5-codex',
        workflow_role: 'research_draft',
        schema_version: 1,
      },
      run_status: 'not-configured',
      not_run_reason: 'OpenAI credentials reauth required',
      support_level: 'unsupported',
      generated_at: '2026-06-01T00:00:00.000Z',
      summary: 'Certification not run: OpenAI credentials reauth required. Provider support level is unsupported.',
    },
  },
  {
    provider_id: 'gemini-cli',
    provider_surface_id: 'gemini-cli',
    vendor_id: 'google-gemini',
    runtime_kind: 'cli',
    auth_mode: 'cli_cached_session',
    workflow_role: 'research_draft',
    billing_mode: 'subscription_entitlement',
    quota_source: 'subscription_tier',
    quota_status: 'unknown',
    data_policy_source: 'subscription_workspace_policy',
    retention_or_zdr_status: 'not_verified',
    headless_supported: false,
    scheduled_workflow_supported: false,
    automation_suitability: 'personal_local_interactive',
    label: 'Gemini CLI',
    description: 'Gemini CLI setup/discovery lane is not yet adapter-complete.',
    catalog_support_level: 'experimental',
    effective_support_level: 'experimental',
    readiness_state: 'unready',
    is_ready: false,
    auth_source: 'missing',
    status_label: 'Gemini CLI setup and readiness discovery only; execution adapter is pending',
    model_role: 'Personal-local experimental candidate',
    limitations: ['Gemini CLI Google sign-in is modeled as setup/discovery-only; execution requires adapter completion.'],
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'adapter',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
      'source-grounding': 'adapter',
      'citation-metadata': 'adapter',
      'url-context': 'unsupported',
      'file-context': 'adapter',
      'source-bundle-production': 'adapter',
      'code-execution': 'unsupported',
      'computer-use': 'unsupported',
      'browser-use': 'unsupported',
    },
    status_rows: [
      { label: 'Surface', value: 'gemini-cli', tone: 'neutral', description: 'Gemini CLI uses vendor google through the cli runtime; provider-family claims do not transfer to sibling surfaces.' },
      { label: 'Auth mode', value: 'cli_cached_session', tone: 'warning', description: 'Credential source category: missing (setup/discovery lane).' },
      { label: 'Billing/quota', value: 'subscription_entitlement; quota unknown', tone: 'warning', description: 'Quota source: subscription_tier. Subscription, API billing, and built-in demo quotas are separate readiness claims.' },
      { label: 'Privacy posture', value: 'subscription_workspace_policy; not_verified', tone: 'warning', description: 'Privacy posture is surface-specific and must not include credential values, raw local paths, cookies, or browser sessions.' },
      { label: 'Role certification', value: 'research_draft: no matching report', tone: 'warning', description: 'No latest certification report matches this surface/auth/model/workflow role target.' },
      { label: 'Local availability', value: 'Locally unavailable', tone: 'neutral', description: 'Local availability will be validated in the Gemini CLI setup lane.' },
      { label: 'Credential status', value: 'No external credential detected yet', tone: 'warning', description: 'No external credential detected yet for setup discovery.' },
      { label: 'Catalog support', value: 'experimental', tone: 'warning', description: 'Static provider matrix claim.' },
      { label: 'Effective support', value: 'experimental', tone: 'warning', description: 'Gating source of truth from latest certification evidence.' },
      { label: 'Workflow certification', value: 'No certification report recorded', tone: 'warning', description: 'No persisted certification evidence exists for this provider.' },
      { label: 'Allowed use', value: 'Setup and readiness discovery only', tone: 'warning', description: 'Execution remains in setup-only mode until adapter and cert paths are implemented.' },
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
    expect(html).toContain('Certified target: mock-provider / built_in_demo / research_draft / mock-research-v2')
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
    expect(html).toContain('OpenAI workflow support is unsupported until reauthentication and report refresh')
    expect(html).toContain('Failure cause: OpenAI credentials reauth required')
    expect(html).toContain('Execution remains blocked until reauthentication and support evidence are refreshed.')

    expect(html).toContain('Gemini CLI')
    expect(html).toContain('Setup and readiness discovery only')
    expect(html).toContain('Execution remains in setup-only mode until adapter and cert paths are implemented.')
    expect(html).not.toContain('>ready</span>')
    expect(html).not.toContain('>not ready</span>')
  })

  it('renders category-labeled status rows instead of ambiguous unlabeled ready badges', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Local availability: Locally runnable')
    expect(html).toContain('Local availability: Locally unavailable')
    expect(html).toContain('Surface: mock-provider')
    expect(html).toContain('Surface: openai-codex-cli')
    expect(html).toContain('Surface: gemini-cli')
    expect(html).toContain('Auth mode: cli_cached_session')
    expect(html).toContain('Billing/quota: subscription_entitlement; quota unknown')
    expect(html).toContain('Privacy posture: subscription_workspace_policy; not_verified')
    expect(html).toContain('Role certification: research_draft: no matching report')
    expect(html).toContain('Role certification: research_draft: unsupported')
    expect(html).toContain('Credential status: Built-in demo provider')
    expect(html).toContain('Credential status: Credentials blocked by latest certification report')
    expect(html).toContain('Credential status: No external credential detected yet')
    expect(html).toContain('Catalog support: experimental')
    expect(html).toContain('Effective support (gating source of truth): unsupported')
    expect(html).toContain('Effective support (gating source of truth): experimental')
    expect(html).toContain('Workflow certification: Report completed')
    expect(html).toContain('Workflow certification: Report not configured')
    expect(html).toContain('Workflow certification: No certification report recorded')
    expect(html).toContain('Allowed use: Demo/e2e deterministic fixture only')
    expect(html).toContain('Allowed use: Blocked for provider-backed workflow starts')
    expect(html).toContain('Allowed use: Setup and readiness discovery only')

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
    expect(html).toContain('Setup-only')
    expect(html).toContain('Unsupported means the latest report or catalog blocks provider-backed workflow starts.')
    expect(html).toContain('Catalog support is the static provider matrix claim.')
    expect(html).toContain('Effective support is the latest certification-bounded support level used for gating.')
  })

  it('separates allowed-use buckets from catalog/effective support buckets', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Provider readiness summary')
    expect(html).toContain('Demo-only: 1')
    expect(html).toContain('Blocked: 2')
    expect(html).toContain('Research draft: 0')
    expect(html).toContain('Setup-only: 1')
    expect(html).toContain('Certified live: 0')
    expect(html).toContain('Catalog support:')
    expect(html).toContain('Certified: 1')
    expect(html).toContain('Experimental: 3')
    expect(html).toContain('Unsupported: 0')
    expect(html).toContain('Effective support buckets')
    expect(html).toContain('Certified: 1')
    expect(html).toContain('Experimental: 1')
    expect(html).toContain('Unsupported: 2')
    expect(html).toContain('OpenAI Codex is blocked: OpenAI workflow support is unsupported until reauthentication and report refresh')
    expect(html).toContain('Claude is blocked: Claude subscription access disabled')
    expect(html).toContain('Gemini CLI is setup-only: Setup and readiness discovery only')
    expect(html).toContain('Action: configure credentials, refresh readiness, or rerun certification after remediation.')
  })

  it('does not repeat not-configured failure prose in report details', () => {
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows }))

    expect(html).toContain('Failure cause: Claude subscription access disabled')
    expect(html).not.toContain('Certification not run: Claude subscription access disabled')
    expect(html).toContain('Technical detail: latest report marked provider support unsupported.')
  })

  it('groups providers by investment-grade and renders honest per-provider badges', () => {
    const gradedRows: ProviderStatusRow[] = [
      { ...rows[0]!, investment_grade: 'suitable', investment_grade_candidate: true },
      { ...rows[1]!, investment_grade: 'candidate', investment_grade_candidate: true },
      { ...rows[3]!, provider_id: 'gemini-cli', investment_grade: 'not-suitable', investment_grade_candidate: false },
    ]
    const html = renderToStaticMarkup(createElement(ProviderStatusPanel, { rows: gradedRows }))

    expect(html).toContain('Investment-grade (certified)')
    expect(html).toContain('Frontier candidates (experimental)')
    expect(html).toContain('Other / unsupported')
    expect(html).toContain('Investment-grade: ✓ suitable for research')
    expect(html).toContain('Investment-grade: candidate — not certified')
    expect(html).toContain('Investment-grade: not suitable for research')
    // e2e-asserted strings must survive grouping
    expect(html).toContain('Mock provider')
    expect(html).toContain('Claude')
    expect(html).toContain('Effective support (gating source of truth): certified')
    expect(html).toContain('Effective support (gating source of truth): unsupported')
  })
})
