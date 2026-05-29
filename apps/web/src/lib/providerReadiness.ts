import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { getProviderCatalog, type ProviderCatalogEntry } from '@owlfolio/providers'
import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import { defaultClaudeCredentialsPath } from './appConfigStore'

type ProviderReadinessEnv = {
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  CODEX_ACCESS_TOKEN?: string
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH?: string
  OWLFOLIO_CODEX_AUTH_PATH?: string
  CODEX_HOME?: string
}

export type ProviderOption = {
  provider_id: ProviderId
  label: string
  support_level: ProviderSupportLevel
  description: string
}

export type ProviderReadiness = {
  provider_id: ProviderId
  support_level: ProviderSupportLevel
  is_ready: boolean
  auth_source: string
  status_label: string
}

export function getProviderOptions(): ProviderOption[] {
  return getProviderCatalog()
    .filter((provider) => provider.visible_in_onboarding)
    .map((provider) => ({
      provider_id: provider.provider_id,
      label: provider.label,
      support_level: provider.support_level,
      description: provider.description,
    }))
}

export async function getProviderReadiness(providerId: ProviderId, env: ProviderReadinessEnv): Promise<ProviderReadiness> {
  const provider = getProviderCatalog().find((entry) => entry.provider_id === providerId)
  if (provider === undefined) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  if (providerId === 'mock-provider') {
    return readinessFrom(provider, true, 'built-in demo mode', 'Ready for deterministic demo mode')
  }

  if (providerId === 'claude') {
    if (env.ANTHROPIC_API_KEY !== undefined && env.ANTHROPIC_API_KEY.length > 0) {
      return readinessFrom(provider, true, 'ANTHROPIC_API_KEY', 'Ready via Anthropic API key')
    }

    const credentialsPath = env.OWLFOLIO_CLAUDE_CREDENTIALS_PATH ?? defaultClaudeCredentialsPath()
    if (await fileExists(credentialsPath)) {
      return readinessFrom(provider, true, 'Claude subscription credentials', 'Ready via Claude subscription credentials')
    }

    return readinessFrom(provider, false, 'missing', 'Missing Claude credentials')
  }

  if (env.OPENAI_API_KEY !== undefined && env.OPENAI_API_KEY.length > 0) {
    return readinessFrom(provider, true, 'OPENAI_API_KEY', 'Ready via OpenAI API key')
  }

  if (env.CODEX_ACCESS_TOKEN !== undefined && env.CODEX_ACCESS_TOKEN.length > 0) {
    return readinessFrom(provider, true, 'CODEX_ACCESS_TOKEN', 'Ready via Codex access token')
  }

  const codexAuthPath = env.OWLFOLIO_CODEX_AUTH_PATH ?? defaultCodexAuthPath(env)
  if (await fileExists(codexAuthPath)) {
    return readinessFrom(provider, true, 'Codex OAuth credentials', 'Ready via Codex OAuth credentials')
  }

  return readinessFrom(provider, false, 'missing', 'Missing OpenAI / Codex credentials')
}

function readinessFrom(
  provider: ProviderCatalogEntry,
  isReady: boolean,
  authSource: string,
  statusLabel: string,
): ProviderReadiness {
  return {
    provider_id: provider.provider_id,
    support_level: provider.support_level,
    is_ready: isReady,
    auth_source: authSource,
    status_label: statusLabel,
  }
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
