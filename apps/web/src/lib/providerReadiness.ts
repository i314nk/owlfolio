import { access } from 'node:fs/promises'

import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import { defaultClaudeCredentialsPath } from './appConfigStore'

type ProviderReadinessEnv = {
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH?: string
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

const providerOptions: ProviderOption[] = [
  {
    provider_id: 'mock-provider',
    label: 'Mock provider',
    support_level: 'certified',
    description: 'Deterministic demo provider for the audited Buffett-Munger vertical slice.',
  },
  {
    provider_id: 'claude',
    label: 'Claude',
    support_level: 'certified',
    description: 'Primary real provider target for personal local mode.',
  },
  {
    provider_id: 'openai',
    label: 'OpenAI',
    support_level: 'experimental',
    description: 'Planned provider path behind readiness and certification checks.',
  },
]

export function getProviderOptions(): ProviderOption[] {
  return providerOptions.map((provider) => ({ ...provider }))
}

export async function getProviderReadiness(providerId: ProviderId, env: ProviderReadinessEnv): Promise<ProviderReadiness> {
  if (providerId === 'mock-provider') {
    return {
      provider_id: 'mock-provider',
      support_level: 'certified',
      is_ready: true,
      auth_source: 'built-in demo mode',
      status_label: 'Ready for deterministic demo mode',
    }
  }

  if (providerId === 'claude') {
    if (env.ANTHROPIC_API_KEY !== undefined && env.ANTHROPIC_API_KEY.length > 0) {
      return {
        provider_id: 'claude',
        support_level: 'certified',
        is_ready: true,
        auth_source: 'ANTHROPIC_API_KEY',
        status_label: 'Ready via Anthropic API key',
      }
    }

    const credentialsPath = env.OWLFOLIO_CLAUDE_CREDENTIALS_PATH ?? defaultClaudeCredentialsPath()
    if (await fileExists(credentialsPath)) {
      return {
        provider_id: 'claude',
        support_level: 'certified',
        is_ready: true,
        auth_source: 'Claude subscription credentials',
        status_label: 'Ready via Claude subscription credentials',
      }
    }

    return {
      provider_id: 'claude',
      support_level: 'certified',
      is_ready: false,
      auth_source: 'missing',
      status_label: 'Missing Claude credentials',
    }
  }

  if (env.OPENAI_API_KEY !== undefined && env.OPENAI_API_KEY.length > 0) {
    return {
      provider_id: 'openai',
      support_level: 'experimental',
      is_ready: true,
      auth_source: 'OPENAI_API_KEY',
      status_label: 'Ready via OpenAI API key',
    }
  }

  return {
    provider_id: 'openai',
    support_level: 'experimental',
    is_ready: false,
    auth_source: 'missing',
    status_label: 'Missing OpenAI credentials',
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
