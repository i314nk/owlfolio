import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  getProviderCatalog,
  type ProviderAuthMode,
  type ProviderCatalogEntry,
  type ProviderCredentialSourceCategory,
  type ProviderReadinessState as ProviderSurfaceReadinessState,
} from '@owlfolio/providers'
import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import { defaultClaudeCredentialsPath } from './appConfigStore'

export type ProviderReadinessEnv = {
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
  GOOGLE_API_KEY?: string
  CODEX_ACCESS_TOKEN?: string
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH?: string
  OWLFOLIO_CODEX_AUTH_PATH?: string
  CODEX_HOME?: string
  GEMINI_HOME?: string
  OWLFOLIO_GEMINI_CLI_AUTH_PATH?: string
  OWLFOLIO_GEMINI_CLI_STATUS?: string
  GOOGLE_OAUTH_ACCESS_TOKEN?: string
  GOOGLE_APPLICATION_CREDENTIALS?: string
  OWLFOLIO_GOOGLE_SERVICE_ACCOUNT_PATH?: string
  GOOGLE_CLOUD_PROJECT?: string
  OPENROUTER_API_KEY?: string
  DEEPSEEK_API_KEY?: string
  DASHSCOPE_API_KEY?: string
  MISTRAL_API_KEY?: string
}
export type ProviderOption = {
  provider_id: ProviderId
  provider_surface_id?: ProviderCatalogEntry['provider_surface_id']
  label: string
  support_level: ProviderSupportLevel
  description: string
  default_model_id?: string
  provider_family_label?: string
  recommended_sign_in_label?: string
  recommended_sign_in_description?: string
  simple_next_step?: string
  advanced_auth_options?: ProviderAdvancedAuthOption[]
}

export type ProviderAdvancedAuthOption = {
  label: string
  description: string
  certification_note: string
}

export type ProviderReadiness = {
  provider_id: ProviderId
  provider_surface_id?: ProviderCatalogEntry['provider_surface_id']
  vendor_id?: ProviderCatalogEntry['vendor_id']
  runtime_kind?: ProviderCatalogEntry['runtime_kind']
  auth_mode?: ProviderAuthMode
  readiness_state?: ProviderSurfaceReadinessState
  credential_source_category?: ProviderCredentialSourceCategory
  credential_source_label?: string
  support_level: ProviderSupportLevel
  is_ready: boolean
  auth_source: string
  status_label: string
  billing_mode?: ProviderCatalogEntry['billing']['billing_mode']
  quota_source?: ProviderCatalogEntry['billing']['quota_source']
  quota_status?: ProviderCatalogEntry['billing']['quota_status']
  data_policy_source?: ProviderCatalogEntry['privacy']['data_policy_source']
  retention_or_zdr_status?: ProviderCatalogEntry['privacy']['retention_or_zdr_status']
  headless_supported?: boolean
  scheduled_workflow_supported?: boolean
  automation_suitability?: ProviderCatalogEntry['automation']['automation_suitability']
  reauth_action?: string
}

export function getProviderOptions(): ProviderOption[] {
  return getProviderCatalog()
    .filter((provider) => provider.visible_in_onboarding)
    .map(providerOptionFromCatalogEntry)
}

export async function getProviderReadiness(providerId: ProviderId, env: ProviderReadinessEnv): Promise<ProviderReadiness> {
  const provider = getProviderCatalog().find((entry) => entry.provider_id === providerId)
  if (provider === undefined) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  if (providerId === 'mock-provider') {
    return readinessFrom(provider, {
      isReady: true,
      authMode: 'built_in_demo',
      readinessState: 'ready',
      credentialSourceCategory: 'built_in',
      authSource: 'built-in demo mode',
      statusLabel: 'Locally runnable through built-in deterministic demo mode',
    })
  }

  if (providerId === 'claude') {
    return claudeReadiness(provider, env)
  }

  if (provider.provider_surface_id === 'openai-codex-cli') {
    return openAICodexCliReadiness(provider, env)
  }

  if (provider.provider_surface_id === 'openrouter-api') {
    return openRouterReadiness(provider, env.OPENROUTER_API_KEY)
  }

  if (provider.support_level === 'unsupported') {
    return unsupportedSurfaceReadiness(provider, env)
  }

  throw new Error(`Readiness not implemented for provider: ${providerId}`)
}

async function claudeReadiness(provider: ProviderCatalogEntry, env: ProviderReadinessEnv): Promise<ProviderReadiness> {
  if (env.ANTHROPIC_API_KEY !== undefined && env.ANTHROPIC_API_KEY.length > 0) {
    return readinessFrom(provider, {
      isReady: true,
      authMode: 'api_key',
      readinessState: 'ready',
      credentialSourceCategory: 'env_var',
      credentialSourceLabel: 'ANTHROPIC_API_KEY',
      authSource: 'ANTHROPIC_API_KEY',
      statusLabel: 'Locally runnable via Anthropic API key',
    })
  }

  const credentialsPath = env.OWLFOLIO_CLAUDE_CREDENTIALS_PATH ?? defaultClaudeCredentialsPath()
  if (await fileExists(credentialsPath)) {
    return readinessFrom(provider, {
      isReady: true,
      authMode: 'cli_cached_session',
      readinessState: 'ready',
      credentialSourceCategory: 'configured_secret_file',
      credentialSourceLabel: 'Claude subscription credentials',
      authSource: 'Claude subscription credentials',
      statusLabel: 'Locally runnable via Claude subscription credentials',
    })
  }

  return readinessFrom(provider, {
    isReady: false,
    authMode: provider.auth_mode,
    readinessState: 'missing_credentials',
    credentialSourceCategory: 'missing',
    authSource: 'missing',
    statusLabel: 'Missing Claude credentials',
  })
}

async function openAICodexCliReadiness(provider: ProviderCatalogEntry, env: ProviderReadinessEnv): Promise<ProviderReadiness> {
  if (env.OPENAI_API_KEY !== undefined && env.OPENAI_API_KEY.length > 0) {
    return readinessFrom(provider, {
      isReady: true,
      authMode: 'api_key',
      readinessState: 'ready',
      credentialSourceCategory: 'env_var',
      credentialSourceLabel: 'OPENAI_API_KEY',
      authSource: 'OPENAI_API_KEY',
      statusLabel: 'Locally runnable via OpenAI API key for the Codex CLI surface; direct OpenAI API certification remains separate.',
    })
  }

  if (env.CODEX_ACCESS_TOKEN !== undefined && env.CODEX_ACCESS_TOKEN.length > 0) {
    return readinessFrom(provider, {
      isReady: true,
      authMode: 'cli_access_token',
      readinessState: 'ready',
      credentialSourceCategory: 'env_var',
      credentialSourceLabel: 'CODEX_ACCESS_TOKEN',
      authSource: 'CODEX_ACCESS_TOKEN',
      statusLabel: 'Locally runnable via Codex access token',
    })
  }

  const codexAuthPath = env.OWLFOLIO_CODEX_AUTH_PATH ?? defaultCodexAuthPath(env)
  if (await fileExists(codexAuthPath)) {
    return readinessFrom(provider, {
      isReady: true,
      authMode: 'cli_cached_session',
      readinessState: 'ready',
      credentialSourceCategory: 'configured_secret_file',
      credentialSourceLabel: 'Codex OAuth credentials',
      authSource: 'Codex OAuth credentials',
      statusLabel: 'Locally runnable via Codex OAuth credentials',
    })
  }

  return readinessFrom(provider, {
    isReady: false,
    authMode: provider.auth_mode,
    readinessState: 'missing_credentials',
    credentialSourceCategory: 'missing',
    authSource: 'missing',
    statusLabel: 'Missing OpenAI / Codex credentials',
  })
}

function openRouterReadiness(
  provider: ProviderCatalogEntry,
  apiKey: string | undefined,
): ProviderReadiness {
  // OpenRouter now has a LIVE OpenAI-compatible adapter (openRouterProvider). A present API key is
  // therefore a runnable credential signal: readiness is true. Readiness is NOT certification — each
  // routed model still needs its own target-specific certification report before it is trusted for real
  // research; the certification/qualification reports carry that gate, not this readiness check.
  if (apiKey !== undefined && apiKey.length > 0) {
    return readinessFrom(provider, {
      isReady: true,
      authMode: 'api_key',
      readinessState: 'ready',
      credentialSourceCategory: 'env_var',
      credentialSourceLabel: 'OPENROUTER_API_KEY',
      authSource: 'OPENROUTER_API_KEY',
      statusLabel: 'OPENROUTER_API_KEY detected and the OpenRouter adapter is live. Each routed model still requires its own certification report before it is trusted for research (readiness is not certification).',
    })
  }

  return readinessFrom(provider, {
    isReady: false,
    authMode: 'api_key',
    readinessState: 'missing_credentials',
    credentialSourceCategory: 'missing',
    authSource: 'missing',
    statusLabel: 'Missing OPENROUTER_API_KEY; the OpenRouter adapter is live but needs a key, and each routed model still requires its own certification report.',
  })
}

function unsupportedSurfaceReadiness(provider: ProviderCatalogEntry, env: ProviderReadinessEnv): ProviderReadiness {
  void env
  const firstCredentialSource = provider.credential_source_categories[0] ?? 'missing'
  return readinessFrom(provider, {
    isReady: false,
    authMode: provider.auth_mode,
    readinessState: 'unsupported_surface',
    credentialSourceCategory: firstCredentialSource,
    ...(firstCredentialSource === 'env_var' ? { credentialSourceLabel: `${provider.provider_surface_id} credentials` } : {}),
    authSource: firstCredentialSource === 'missing' ? 'missing' : firstCredentialSource,
    statusLabel: `${provider.label} is modeled in the catalog, but the adapter is not implemented or certified yet.`,
  })
}

function readinessFrom(
  provider: ProviderCatalogEntry,
  values: {
    isReady: boolean
    authMode: ProviderAuthMode
    readinessState: ProviderSurfaceReadinessState
    credentialSourceCategory: ProviderCredentialSourceCategory
    credentialSourceLabel?: string | undefined
    authSource: string
    statusLabel: string
    quotaStatus?: ProviderCatalogEntry['billing']['quota_status']
    dataPolicySource?: ProviderCatalogEntry['privacy']['data_policy_source']
  },
): ProviderReadiness {
  return {
    provider_id: provider.provider_id,
    provider_surface_id: provider.provider_surface_id,
    vendor_id: provider.vendor_id,
    runtime_kind: provider.runtime_kind,
    auth_mode: values.authMode,
    readiness_state: values.readinessState,
    credential_source_category: values.credentialSourceCategory,
    ...(values.credentialSourceLabel === undefined ? {} : { credential_source_label: values.credentialSourceLabel }),
    support_level: provider.support_level,
    is_ready: values.isReady,
    auth_source: values.authSource,
    status_label: values.statusLabel,
    billing_mode: provider.billing.billing_mode,
    quota_source: provider.billing.quota_source,
    quota_status: values.quotaStatus ?? provider.billing.quota_status,
    data_policy_source: values.dataPolicySource ?? provider.privacy.data_policy_source,
    retention_or_zdr_status: provider.privacy.retention_or_zdr_status,
    headless_supported: provider.automation.headless_supported,
    scheduled_workflow_supported: provider.automation.scheduled_workflow_supported,
    automation_suitability: provider.automation.automation_suitability,
    reauth_action: reauthActionFor(provider, values.authMode),
  }
}

function reauthActionFor(provider: ProviderCatalogEntry, authMode: ProviderAuthMode): string {
  if (provider.provider_surface_id === 'openai-codex-cli') {
    return 'Run codex login outside Owlfolio, then retry readiness.'
  }

  if (provider.provider_surface_id === 'claude-cli') {
    return 'Run claude login or configure Anthropic credentials outside Owlfolio, then retry readiness.'
  }

  if (authMode === 'api_key') {
    return 'Configure the provider API key, then retry readiness.'
  }

  return 'Retry provider setup after resolving the reported credential status.'
}

function defaultCodexAuthPath(env: Pick<ProviderReadinessEnv, 'CODEX_HOME'>): string {
  if (env.CODEX_HOME !== undefined && env.CODEX_HOME.length > 0) {
    return join(env.CODEX_HOME, 'auth.json')
  }

  return join(homedir(), '.codex', 'auth.json')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function providerOptionFromCatalogEntry(provider: ProviderCatalogEntry): ProviderOption {
  const base = {
    provider_id: provider.provider_id,
    provider_surface_id: provider.provider_surface_id,
    label: onboardingLabelFor(provider),
    support_level: provider.support_level,
    description: onboardingDescriptionFor(provider),
    default_model_id: provider.default_model_id,
  }

  if (provider.provider_surface_id === 'openai-codex-cli') {
    return {
      ...base,
      provider_family_label: 'OpenAI',
      recommended_sign_in_label: 'Connect Codex',
      recommended_sign_in_description: 'Run codex login outside Owlfolio; Owlfolio verifies the local CLI session and does not claim a browser OAuth handoff.',
      simple_next_step: 'Run codex login outside Owlfolio, then refresh readiness.',
      advanced_auth_options: [
        {
          label: 'OpenAI API key',
          description: 'Direct OpenAI API key path for certification-oriented provider runs and future production/headless support.',
          certification_note: 'Separate direct API certification is required; Codex CLI personal-local readiness does not certify the OpenAI API surface.',
        },
      ],
    }
  }

  if (provider.provider_surface_id === 'claude-cli') {
    return {
      ...base,
      provider_family_label: 'Anthropic',
      recommended_sign_in_label: 'Sign in with Claude CLI',
      recommended_sign_in_description: 'Run claude login outside Owlfolio or configure Anthropic credentials, then verify readiness.',
      simple_next_step: 'Run claude login outside Owlfolio, then refresh readiness.',
    }
  }

  return base
}

function onboardingLabelFor(provider: ProviderCatalogEntry): string {
  if (provider.provider_surface_id === 'openai-codex-cli') {
    return 'OpenAI'
  }

  return provider.label
}

function onboardingDescriptionFor(provider: ProviderCatalogEntry): string {
  if (provider.provider_surface_id === 'openai-codex-cli') {
    return 'Recommended Codex CLI personal-local sign-in path; direct API certification remains an advanced option.'
  }

  return provider.description
}
