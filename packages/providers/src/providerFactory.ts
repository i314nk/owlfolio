import type { ProviderId } from '@owlfolio/shared'

import { MockProvider, type MockProviderOptions } from './mockProvider'
import { OpenRouterProvider, type OpenRouterProviderOptions } from './openRouterProvider'
import type { Provider } from './providerContract'

export type ResolveProviderOptions = OpenRouterProviderOptions & {
  provider_id: ProviderId
  mockOptions?: MockProviderOptions
}

export function resolveProvider(options: ResolveProviderOptions): Provider {
  if (options.provider_id === 'mock-provider') {
    return new MockProvider(options.mockOptions)
  }

  if (options.provider_id === 'openrouter') {
    return new OpenRouterProvider(options)
  }

  // The experimental LOCAL surface (owner, 2026-07-18): an OpenAI-compatible endpoint the user runs
  // themselves (Ollama / vLLM), via the same generalized adapter. UNSTABLE / UNTESTED — fail-closed.
  // `reasoningBody: {}` omits OpenRouter's unified `reasoning` param (local endpoints reject unknown
  // params). Most local servers need no auth: a placeholder bearer is sent when no key is configured.
  if (options.provider_id === 'local') {
    const env = options.env ?? process.env
    return new OpenRouterProvider({
      ...options,
      providerId: 'local',
      label: 'Local (Ollama / vLLM)',
      apiKeyEnvVar: 'OWLFOLIO_LOCAL_API_KEY',
      apiKey: options.apiKey ?? env['OWLFOLIO_LOCAL_API_KEY'] ?? 'local-no-auth',
      baseUrl: options.baseUrl ?? env['OWLFOLIO_LOCAL_API_BASE_URL'] ?? 'http://127.0.0.1:11434/v1',
      surfaceId: 'local',
      vendorId: 'local',
      reasoningBody: {},
      extraHeaders: {},
    })
  }

  throw new Error(`Unsupported provider: ${options.provider_id}`)
}
