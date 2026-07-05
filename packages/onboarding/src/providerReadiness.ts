import {
  getProviderCatalog,
  type ProviderAuthMode,
  type ProviderCatalogEntry,
  type ProviderCredentialSourceCategory,
  type ProviderReadinessState as ProviderSurfaceReadinessState,
} from '@owlfolio/providers'
import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'


export type ProviderReadinessEnv = {
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
  GOOGLE_API_KEY?: string
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

/**
 * Provider options for the user-facing onboarding wizard and `/settings/providers` guided setup.
 *
 * `mock-provider` is the deterministic TEST/e2e harness and stays in the catalog, but it is NEVER offered
 * in the onboarding picker — onboarding presents real providers only (unconfigured → personal-local).
 * The e2e/unit suites select the mock provider by initializing personal-local programmatically via the
 * onboarding init seam, not through this picker.
 */
export type ProviderOptionsEnv = { readonly [key: string]: string | undefined }

export function getProviderOptions(_env: ProviderOptionsEnv = process.env): ProviderOption[] {
  return getProviderCatalog()
    .filter((provider) => provider.visible_in_onboarding && provider.provider_id !== 'mock-provider')
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

  if (provider.provider_surface_id === 'openrouter-api') {
    return openRouterReadiness(provider, env.OPENROUTER_API_KEY)
  }

  // Direct OpenAI-compatible API surfaces (key path) — a present key is a runnable credential signal via the
  // generalized adapter. Readiness is NOT certification: each stays experimental/fail-closed until a
  // target-specific certification report exists.
  if (provider.provider_surface_id === 'openai-api') {
    return directApiReadiness(provider, 'OPENAI_API_KEY', env.OPENAI_API_KEY)
  }

  if (provider.provider_surface_id === 'anthropic-api') {
    return directApiReadiness(provider, 'ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY)
  }

  if (provider.provider_surface_id === 'gemini-developer-api') {
    return directApiReadiness(provider, 'GEMINI_API_KEY', env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY)
  }

  if (provider.support_level === 'unsupported') {
    return unsupportedSurfaceReadiness(provider, env)
  }

  throw new Error(`Readiness not implemented for provider: ${providerId}`)
}

/** Readiness for a direct OpenAI-compatible API surface: key present → ready (experimental, not certified). */
function directApiReadiness(provider: ProviderCatalogEntry, keyName: string, apiKey: string | undefined): ProviderReadiness {
  if (apiKey !== undefined && apiKey.length > 0) {
    return readinessFrom(provider, {
      isReady: true,
      authMode: 'api_key',
      readinessState: 'ready',
      credentialSourceCategory: 'env_var',
      credentialSourceLabel: keyName,
      authSource: keyName,
      statusLabel: `${keyName} detected; the ${provider.label} direct API adapter is live. Experimental until a target-specific certification report exists (readiness is not certification).`,
    })
  }

  return readinessFrom(provider, {
    isReady: false,
    authMode: 'api_key',
    readinessState: 'missing_credentials',
    credentialSourceCategory: 'missing',
    authSource: 'missing',
    statusLabel: `Missing ${keyName}; set it to use the ${provider.label} direct API (experimental, fail-closed until certified).`,
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

function reauthActionFor(_provider: ProviderCatalogEntry, authMode: ProviderAuthMode): string {
  if (authMode === 'api_key') {
    return 'Configure the provider API key, then retry readiness.'
  }

  return 'Retry provider setup after resolving the reported credential status.'
}

function providerOptionFromCatalogEntry(provider: ProviderCatalogEntry): ProviderOption {
  // All surviving providers are API-key surfaces (OpenRouter + direct APIs); no CLI/OAuth sign-in lanes.
  return {
    provider_id: provider.provider_id,
    provider_surface_id: provider.provider_surface_id,
    label: provider.label,
    support_level: provider.support_level,
    description: provider.description,
    default_model_id: provider.default_model_id,
  }
}
